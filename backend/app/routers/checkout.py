import json
import secrets
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Customer, Order, OrderItem, PaymentEvent
from ..schemas import CreateOrderIn, CreateOrderOut, EventOut, OrderOut, Quote, QuoteIn, VerifyIn
from ..services import payments
from ..services.orders import mark_order_failed, mark_order_paid
from ..services.customer_auth import optional_customer
from ..services.fulfilment import add_event, after_payment, is_confirmed
from ..services.notify import inr
from ..services.pricing import build_quote

router = APIRouter(prefix="/api", tags=["checkout"])


def _order_number() -> str:
    return f"IRV{datetime.now():%y%m%d}{secrets.randbelow(10**4):04d}"


def order_out(o: Order) -> OrderOut:
    """Customer-facing view: includes only the public timeline events."""
    out = OrderOut.model_validate(o)
    out.timeline = [EventOut.model_validate(e) for e in o.events if e.public]
    return out


def _confirm(db: Session, order: Order, payment_id: str, source: str, background: BackgroundTasks) -> None:
    """Mark paid exactly once; the first caller (verify or webhook) schedules emails + shipment."""
    was_confirmed = is_confirmed(order)
    mark_order_paid(db, order, payment_id)
    if not was_confirmed and is_confirmed(order):
        msg = (f"COD advance {inr(order.pay_now)} paid online · {inr(order.pay_on_delivery)} due on delivery"
               if order.payment_method == "cod" else f"Paid {inr(order.total)} online")
        add_event(db, order, "payment", f"{msg} ({source}, {payment_id})")
        add_event(db, order, "status", "Order confirmed", public=True)
        background.add_task(after_payment, order.number)


@router.post("/checkout/quote", response_model=Quote)
def quote(data: QuoteIn, db: Session = Depends(get_db)):
    return build_quote(db, data)


@router.post("/checkout/orders", response_model=CreateOrderOut, status_code=201)
def create_order(data: CreateOrderIn, db: Session = Depends(get_db), x_session_id: str = Header(""),
                 customer: Customer | None = Depends(optional_customer)):
    s = get_settings()
    q = build_quote(db, data)
    if customer:  # remember contact + address for next time
        customer.name = customer.name or data.customer.name
        customer.phone = customer.phone or data.customer.phone
        customer.address = data.address.model_dump()
    order = Order(customer_id=customer.id if customer else None,
        number=_order_number(), session_id=x_session_id[:64], payment_method=q.payment_method,
        customer=data.customer.model_dump(), address=data.address.model_dump(),
        subtotal=q.subtotal, discount=q.discount, shipping=q.shipping, total=q.total,
        pay_now=q.pay_now, pay_on_delivery=q.pay_on_delivery, coupon=q.coupon,
        items=[OrderItem(product_id=l.product_id, name=l.name, size=l.size, unit_price=l.unit_price,
                         quantity=l.quantity) for l in q.lines],
    )
    amount_paise = q.pay_now * 100
    order.razorpay_order_id = payments.create_gateway_order(
        amount_paise, receipt=order.number,
        notes={"order_number": order.number, "payment_method": q.payment_method},
    )
    db.add(order)
    db.commit()
    return CreateOrderOut(
        order_number=order.number, razorpay_order_id=order.razorpay_order_id,
        key_id=s.razorpay_key_id or "rzp_mock", amount_paise=amount_paise, currency=s.currency,
        mock=s.payments_mock, quote=q,
        prefill={"name": data.customer.name, "email": data.customer.email, "contact": data.customer.phone},
    )


@router.post("/checkout/verify", response_model=OrderOut)
def verify(data: VerifyIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.razorpay_order_id == data.razorpay_order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if not payments.verify_payment_signature(data.razorpay_order_id, data.razorpay_payment_id,
                                             data.razorpay_signature):
        raise HTTPException(400, "Payment signature mismatch")
    _confirm(db, order, data.razorpay_payment_id, "checkout", background)
    db.add(PaymentEvent(event_id=f"verify:{data.razorpay_payment_id}", source="verify",
                        order_number=order.number, payload=data.model_dump()))
    try:
        db.commit()
    except IntegrityError:  # same payment verified twice — already recorded
        db.rollback()
    db.refresh(order)
    return order_out(order)


@router.post("/checkout/mock-pay")
def mock_pay(payload: dict):
    """Simulates Razorpay Checkout's success callback. Disabled automatically when real keys are set."""
    if not get_settings().payments_mock:
        raise HTTPException(404)
    return payments.mock_sign(str(payload.get("razorpay_order_id", "")))


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, background: BackgroundTasks, db: Session = Depends(get_db),
                           x_razorpay_signature: str = Header(""), x_razorpay_event_id: str = Header("")):
    body = await request.body()
    if not payments.verify_webhook_signature(body, x_razorpay_signature):
        raise HTTPException(400, "Invalid webhook signature")
    event = json.loads(body)
    event_id = x_razorpay_event_id or f"{event.get('event')}:{event.get('created_at')}"
    if db.query(PaymentEvent).filter_by(event_id=event_id).first():
        return {"ok": True, "duplicate": True}

    payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    order = db.query(Order).filter(Order.razorpay_order_id == payment.get("order_id", "")).first()
    if order:
        if event.get("event") in ("payment.captured", "order.paid"):
            _confirm(db, order, payment.get("id", ""), "webhook", background)
        elif event.get("event") == "payment.failed":
            mark_order_failed(order)
    db.add(PaymentEvent(event_id=event_id, source="webhook", order_number=order.number if order else "",
                        payload=event))
    db.commit()
    return {"ok": True}


@router.get("/orders/{number}", response_model=OrderOut)
def get_order(number: str, db: Session = Depends(get_db), x_session_id: str = Header(""),
              customer: Customer | None = Depends(optional_customer)):
    """Visible to the browser that placed it, or to the signed-in owner."""
    order = db.query(Order).filter(Order.number == number).first()
    owner = customer is not None and order is not None and order.customer_id == customer.id
    if not order or not (owner or (order.session_id and order.session_id == x_session_id)):
        raise HTTPException(404, "Order not found")
    return order_out(order)
