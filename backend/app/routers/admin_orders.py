import csv
import hmac
import io
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..db import get_db
from ..models import NotificationLog, Order, utcnow
from ..schemas import AdminOrderOut, CodBulkIn, CodIn, EventOut, NoteIn, StatusIn
from ..services import notify, shiprocket
from ..services.auth import require_admin
from ..services.fulfilment import TransitionError, add_event, create_shipment, is_confirmed, set_fulfilment

router = APIRouter(prefix="/api/admin", tags=["admin-orders"], dependencies=[Depends(require_admin)])
hooks = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class OrderRow(BaseModel):
    number: str
    created_at: datetime
    customer_name: str
    customer_phone: str
    city: str
    items: int
    total: int
    payment_method: str
    status: str
    fulfilment_status: str
    pay_on_delivery: int
    awb_code: str
    courier_name: str
    shipment_error: str
    cod_collected: bool
    cod_remitted: bool


def _row(o: Order) -> OrderRow:
    c, a = o.customer or {}, o.address or {}
    return OrderRow(number=o.number, created_at=o.created_at, customer_name=c.get("name", ""),
                    customer_phone=c.get("phone", ""), city=a.get("city", ""),
                    items=sum(i.quantity for i in o.items), total=o.total, payment_method=o.payment_method,
                    status=o.status, fulfilment_status=o.fulfilment_status or "unfulfilled",
                    pay_on_delivery=o.pay_on_delivery, awb_code=o.awb_code, courier_name=o.courier_name,
                    shipment_error=o.shipment_error, cod_collected=o.cod_collected, cod_remitted=o.cod_remitted)


def _get(db: Session, number: str) -> Order:
    o = (db.query(Order).options(selectinload(Order.items), selectinload(Order.events))
         .filter(Order.number == number).first())
    if not o:
        raise HTTPException(404, "Order not found")
    return o


def _detail(db: Session, o: Order) -> AdminOrderOut:
    out = AdminOrderOut.model_validate(o)
    out.events = [EventOut.model_validate(e) for e in o.events]
    out.timeline = [EventOut.model_validate(e) for e in o.events if e.public]
    out.notifications = [{"channel": n.channel, "event": n.event, "to": n.to, "status": n.status, "error": n.error,
                          "created_at": n.created_at.isoformat()}
                         for n in db.query(NotificationLog).filter(NotificationLog.order_number == o.number)
                         .order_by(NotificationLog.id.desc()).limit(50)]
    return out


def _filtered(db: Session, status: str, fulfilment: str, method: str, cod: str, q: str):
    query = db.query(Order).options(selectinload(Order.items))
    if status == "confirmed":
        query = query.filter(Order.status.in_(["paid", "cod_confirmed"]))
    elif status:
        query = query.filter(Order.status == status)
    if fulfilment:
        query = query.filter(Order.fulfilment_status == fulfilment)
    if method:
        query = query.filter(Order.payment_method == method)
    if cod:
        query = query.filter(Order.payment_method == "cod", Order.status == "cod_confirmed")
        if cod == "awaiting_delivery":
            query = query.filter(Order.cod_collected.is_(False), Order.fulfilment_status.notin_(["cancelled", "rto"]))
        elif cod == "collected_not_remitted":
            query = query.filter(Order.cod_collected.is_(True), Order.cod_remitted.is_(False))
        elif cod == "remitted":
            query = query.filter(Order.cod_remitted.is_(True))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Order.number.ilike(like), Order.awb_code.ilike(like)))
    return query


@router.get("/orders")
def list_orders(db: Session = Depends(get_db), status: str = "confirmed", fulfilment: str = "", method: str = "",
                cod: str = "", q: str = "", limit: int = 50, offset: int = 0):
    query = _filtered(db, status, fulfilment, method, cod, q)
    total = query.count()
    rows = query.order_by(Order.id.desc()).offset(offset).limit(min(limit, 200)).all()
    if q and not rows:  # fall back to searching customer name / phone / email inside the JSON
        t = q.strip().lower()
        everything = _filtered(db, status, fulfilment, method, cod, "").order_by(Order.id.desc()).limit(2000).all()
        rows = [o for o in everything if t in " ".join(str(v) for v in (o.customer or {}).values()).lower()]
        total = len(rows)
        rows = rows[offset:offset + limit]
    return {"items": [_row(o) for o in rows], "total": total}


@router.get("/orders.csv")
def export_orders(db: Session = Depends(get_db), status: str = "confirmed", fulfilment: str = "", method: str = "",
                  cod: str = "", q: str = ""):
    rows = _filtered(db, status, fulfilment, method, cod, q).order_by(Order.id.desc()).limit(10000).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Order", "Date", "Customer", "Phone", "Email", "City", "Pincode", "Method", "Payment status",
                "Fulfilment", "Total", "Paid online", "COD amount", "COD collected", "COD collected amount",
                "COD remitted", "UTR", "Remitted at", "Courier", "AWB"])
    for o in rows:
        c, a = o.customer or {}, o.address or {}
        w.writerow([o.number, o.created_at.strftime("%Y-%m-%d %H:%M"), c.get("name"), c.get("phone"), c.get("email"),
                    a.get("city"), a.get("pincode"), o.payment_method.upper(), o.status, o.fulfilment_status, o.total,
                    o.pay_now if is_confirmed(o) else 0, o.pay_on_delivery, "yes" if o.cod_collected else "no",
                    o.cod_collected_amount, "yes" if o.cod_remitted else "no", o.cod_remittance_utr,
                    o.cod_remitted_at.strftime("%Y-%m-%d") if o.cod_remitted_at else "", o.courier_name, o.awb_code])
    name = f"iravath-orders-{datetime.now():%Y%m%d}.csv"
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/orders/{number}", response_model=AdminOrderOut)
def order_detail(number: str, db: Session = Depends(get_db)):
    return _detail(db, _get(db, number))


@router.post("/orders/{number}/status", response_model=AdminOrderOut)
def change_status(number: str, data: StatusIn, background: BackgroundTasks, db: Session = Depends(get_db),
                  admin: str = Depends(require_admin)):
    o = _get(db, number)
    try:
        event = set_fulfilment(db, o, data.status, actor=admin, note=data.note, awb_code=data.awb_code,
                               courier_name=data.courier_name, tracking_url=data.tracking_url)
    except TransitionError as e:
        raise HTTPException(409, str(e))
    if data.status == "shipped" and not o.tracking_url and o.awb_code:
        o.tracking_url = f"https://shiprocket.co/tracking/{o.awb_code}"
    db.commit()
    if event and data.notify:
        background.add_task(notify.notify_order, o.number, event)
    db.refresh(o)
    return _detail(db, o)


@router.post("/orders/{number}/shipment", response_model=AdminOrderOut)
def ship(number: str, db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    o = _get(db, number)
    try:
        create_shipment(db, o, actor=admin)
    except TransitionError as e:
        raise HTTPException(409, str(e))
    db.commit()
    db.refresh(o)
    return _detail(db, o)


@router.post("/orders/{number}/cod", response_model=AdminOrderOut)
def update_cod(number: str, data: CodIn, db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    o = _get(db, number)
    if o.payment_method != "cod" or o.status != "cod_confirmed":
        raise HTTPException(409, "Not a confirmed COD order")
    if data.collected is not None:
        o.cod_collected = data.collected
        o.cod_collected_amount = (data.collected_amount if data.collected_amount is not None else o.pay_on_delivery) \
            if data.collected else 0
        add_event(db, o, "cod", (f"COD marked collected: {notify.inr(o.cod_collected_amount)}" if data.collected
                                 else "COD marked not collected") + (f" · {data.note}" if data.note else ""), admin)
        if data.collected and o.cod_collected_amount != o.pay_on_delivery:
            add_event(db, o, "cod", f"Short/excess collection: expected {notify.inr(o.pay_on_delivery)}, "
                                    f"got {notify.inr(o.cod_collected_amount)}", admin)
    if data.remitted is not None:
        if data.remitted and not o.cod_collected:
            raise HTTPException(409, "Mark the COD as collected before marking it remitted")
        if data.remitted and not data.utr.strip() and not o.cod_remittance_utr:
            raise HTTPException(422, "Enter the remittance UTR / reference")
        o.cod_remitted = data.remitted
        o.cod_remittance_utr = data.utr.strip() or o.cod_remittance_utr if data.remitted else ""
        o.cod_remitted_at = utcnow() if data.remitted else None
        add_event(db, o, "cod", f"COD remitted to bank · UTR {o.cod_remittance_utr}" if data.remitted
                  else "COD remittance undone", admin)
    db.commit()
    db.refresh(o)
    return _detail(db, o)


@router.post("/cod/remit")
def bulk_remit(data: CodBulkIn, db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    """Mark many COD orders as remitted with one UTR (Shiprocket remits in batches)."""
    done, skipped = [], []
    for o in db.query(Order).filter(Order.number.in_(data.order_numbers)).all():
        if o.payment_method == "cod" and o.cod_collected and not o.cod_remitted:
            o.cod_remitted, o.cod_remittance_utr, o.cod_remitted_at = True, data.utr.strip(), utcnow()
            add_event(db, o, "cod", f"COD remitted to bank · UTR {o.cod_remittance_utr} (batch)", admin)
            done.append(o.number)
        else:
            skipped.append(o.number)
    db.commit()
    return {"remitted": done, "skipped": skipped,
            "amount": sum(o.cod_collected_amount for o in db.query(Order).filter(Order.number.in_(done)))}


@router.get("/cod/summary")
def cod_summary(db: Session = Depends(get_db)):
    rows = db.query(Order).filter(Order.payment_method == "cod", Order.status == "cod_confirmed").all()
    open_ = [o for o in rows if not o.cod_collected and o.fulfilment_status not in ("cancelled", "rto")]
    collected = [o for o in rows if o.cod_collected and not o.cod_remitted]
    remitted = [o for o in rows if o.cod_remitted]
    return {
        "awaiting_delivery": {"count": len(open_), "amount": sum(o.pay_on_delivery for o in open_)},
        "collected_not_remitted": {"count": len(collected), "amount": sum(o.cod_collected_amount for o in collected)},
        "remitted": {"count": len(remitted), "amount": sum(o.cod_collected_amount for o in remitted)},
        "short_collections": [o.number for o in rows if o.cod_collected and o.cod_collected_amount != o.pay_on_delivery],
    }


@router.post("/orders/{number}/note", response_model=AdminOrderOut)
def add_note(number: str, data: NoteIn, db: Session = Depends(get_db), admin: str = Depends(require_admin)):
    o = _get(db, number)
    add_event(db, o, "note", data.note, admin)
    db.commit()
    db.refresh(o)
    return _detail(db, o)


@router.post("/orders/{number}/notify/{event}")
def resend(number: str, event: str, background: BackgroundTasks, db: Session = Depends(get_db)):
    if event not in ("order_confirmed", "order_shipped", "out_for_delivery", "order_delivered", "order_cancelled"):
        raise HTTPException(422, "Unknown notification")
    _get(db, number)
    background.add_task(notify.notify_order, number, event)
    return {"ok": True}


# ---------- Shiprocket tracking webhook ----------
RANK = {"unfulfilled": 0, "processing": 1, "shipped": 2, "out_for_delivery": 3, "delivered": 4, "rto": 4, "cancelled": 4}


@hooks.post("/shiprocket")
async def shiprocket_webhook(request: Request, background: BackgroundTasks, db: Session = Depends(get_db),
                             x_api_key: str = Header("")):
    """Configure in Shiprocket: Settings -> API -> Webhooks, URL = {API_URL}/api/webhooks/shiprocket,
    token = SHIPROCKET_WEBHOOK_TOKEN (sent as x-api-key)."""
    token = get_settings().shiprocket_webhook_token
    if not token or not hmac.compare_digest(x_api_key, token):
        raise HTTPException(401, "Bad token")
    body = await request.json()
    awb, current = str(body.get("awb", "")), str(body.get("current_status", "")).upper().strip()
    o = None
    if awb:
        o = db.query(Order).filter(Order.awb_code == awb).first()
    if not o and body.get("order_id"):
        o = db.query(Order).filter(Order.number == str(body["order_id"])).first()
    if not o:
        return {"ok": True, "matched": False}
    new = shiprocket.WEBHOOK_STATUS.get(current)
    if not o.awb_code and awb:
        o.awb_code, o.tracking_url = awb, f"https://shiprocket.co/tracking/{awb}"
    if body.get("courier_name") and not o.courier_name:
        o.courier_name = body["courier_name"]
    event = None
    if new and RANK.get(new, 0) > RANK.get(o.fulfilment_status or "unfulfilled", 0):
        try:
            event = set_fulfilment(db, o, new, actor="shiprocket", note=current.title(), force=True)
        except TransitionError:
            event = None
    else:
        add_event(db, o, "shipment", f"Courier update: {current.title() or 'unknown'}", "shiprocket")
    db.commit()
    if event:
        background.add_task(notify.notify_order, o.number, event)
    return {"ok": True, "matched": True}
