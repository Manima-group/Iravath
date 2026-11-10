"""Order lifecycle after payment: status transitions, shipments, COD reconciliation, notifications."""
import logging

from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal
from ..models import Order, OrderEvent, Product, utcnow
from . import notify, shiprocket

log = logging.getLogger("iravath.fulfilment")

LABELS = {
    "unfulfilled": "Order received", "processing": "Packed & ready to ship", "shipped": "Shipped",
    "out_for_delivery": "Out for delivery", "delivered": "Delivered", "cancelled": "Cancelled", "rto": "Returned to us",
}
TRANSITIONS = {
    "unfulfilled": {"processing", "shipped", "cancelled"},
    "processing": {"unfulfilled", "shipped", "cancelled"},
    "shipped": {"out_for_delivery", "delivered", "rto"},
    "out_for_delivery": {"shipped", "delivered", "rto"},
    "delivered": set(),
    "cancelled": set(),
    "rto": set(),
}
NOTIFY_ON = {"shipped": "order_shipped", "out_for_delivery": "out_for_delivery",
             "delivered": "order_delivered", "cancelled": "order_cancelled"}


class TransitionError(ValueError):
    pass


def add_event(db: Session, o: Order, kind: str, message: str, actor: str = "system", public: bool = False) -> None:
    db.add(OrderEvent(order_id=o.id, kind=kind, message=message[:400], actor=actor, public=public))


def is_confirmed(o: Order) -> bool:
    return o.status in ("paid", "cod_confirmed")


def _restock(db: Session, o: Order) -> None:
    for item in o.items:
        p = db.get(Product, item.product_id)
        if p:
            sizes = dict(p.sizes)
            sizes[item.size] = sizes.get(item.size, 0) + item.quantity
            p.sizes = sizes


def set_fulfilment(db: Session, o: Order, new: str, actor: str = "system", note: str = "",
                   awb_code: str = "", courier_name: str = "", tracking_url: str = "", force: bool = False) -> str | None:
    """Apply a status change. Returns the notification event to send (or None). Caller commits."""
    old = o.fulfilment_status or "unfulfilled"
    if new == old:
        return None
    if new not in LABELS:
        raise TransitionError(f"Unknown status {new}")
    if not force and new not in TRANSITIONS[old]:
        raise TransitionError(f"Can't move an order from “{LABELS[old]}” to “{LABELS[new]}”")
    if new != "cancelled" and not is_confirmed(o):
        raise TransitionError("Only paid or COD-confirmed orders can be fulfilled")

    if awb_code:
        o.awb_code = awb_code.strip()
    if courier_name:
        o.courier_name = courier_name.strip()
    if tracking_url:
        o.tracking_url = tracking_url.strip()
    if new == "shipped" and not o.shipped_at:
        o.shipped_at = utcnow()
    if new == "delivered":
        o.delivered_at = utcnow()
        if o.payment_method == "cod" and not o.cod_collected:
            o.cod_collected, o.cod_collected_amount = True, o.pay_on_delivery
            add_event(db, o, "cod", f"COD {notify.inr(o.pay_on_delivery)} collected by courier on delivery", actor)
    if new == "cancelled":
        if is_confirmed(o):
            _restock(db, o)
            if o.pay_now:
                add_event(db, o, "payment", f"Refund {notify.inr(o.pay_now)} to the customer from the Razorpay dashboard "
                                            f"(payment {o.razorpay_payment_id or '-'})", actor)
        if o.shiprocket_order_id:
            try:
                shiprocket.cancel_order(o.shiprocket_order_id)
                add_event(db, o, "shipment", "Shiprocket order cancelled", actor)
            except Exception as e:
                add_event(db, o, "shipment", f"Could not cancel on Shiprocket: {e}"[:400], actor)
        if o.status == "pending_payment":
            o.status = "cancelled"
    if new == "rto" and o.payment_method == "cod":
        add_event(db, o, "cod", "Returned to origin: no COD amount will be remitted", actor)

    o.fulfilment_status = new
    add_event(db, o, "status", f"{LABELS[old]} → {LABELS[new]}" + (f" · {note}" if note else ""), actor)
    add_event(db, o, "status", LABELS[new], actor, public=True)
    return NOTIFY_ON.get(new)


def create_shipment(db: Session, o: Order, actor: str = "system") -> None:
    """Idempotent: creates the Shiprocket order if missing, then the AWB if missing. Caller commits."""
    s = get_settings()
    if not is_confirmed(o):
        raise TransitionError("Only paid or COD-confirmed orders can be shipped")
    if o.fulfilment_status in ("cancelled", "rto", "delivered"):
        raise TransitionError("This order is closed")
    try:
        if not o.shiprocket_shipment_id:
            r = shiprocket.create_order(o)
            o.shiprocket_order_id, o.shiprocket_shipment_id = r["order_id"], r["shipment_id"]
            add_event(db, o, "shipment", f"Shiprocket order {r['order_id']} created"
                                         + (" (mock)" if shiprocket.is_mock() else ""), actor)
        if s.shiprocket_auto_awb and not o.awb_code:
            r = shiprocket.assign_awb(o.shiprocket_shipment_id)
            o.awb_code, o.courier_name, o.tracking_url = r["awb_code"], r["courier_name"], r["tracking_url"]
            add_event(db, o, "shipment", f"AWB {r['awb_code']} assigned · {r['courier_name']}", actor)
        o.shipment_error = ""
        if o.fulfilment_status == "unfulfilled":
            set_fulfilment(db, o, "processing", actor)
    except shiprocket.ShiprocketError as e:
        o.shipment_error = str(e)[:300]
        add_event(db, o, "shipment", f"Shipment failed: {e}", actor)
    except Exception as e:  # network etc.
        log.exception("shipment for %s failed", o.number)
        o.shipment_error = f"Unexpected error: {e}"[:300]
        add_event(db, o, "shipment", o.shipment_error, actor)


def after_payment(order_number: str) -> None:
    """Background task run once an order becomes paid / cod_confirmed."""
    notify.notify_order(order_number, "order_confirmed")
    if not get_settings().shiprocket_auto_create:
        return
    db = SessionLocal()
    try:
        o = db.query(Order).filter(Order.number == order_number).first()
        if o and is_confirmed(o):
            create_shipment(db, o)
            db.commit()
    finally:
        db.close()
