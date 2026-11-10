import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Order, OrderItem, PaymentEvent
from ..schemas import CreateOrderIn, CreateOrderOut, OrderOut, Quote, QuoteIn, VerifyIn
from ..services import payments
from ..services.orders import mark_order_failed, mark_order_paid
from ..services.pricing import build_quote

router = APIRouter(prefix="/api", tags=["checkout"])


def _order_number() -> str:
    return f"IRV{datetime.now():%y%m%d}{secrets.randbelow(10**4):04d}"


@router.post("/checkout/quote", response_model=Quote)
def quote(data: QuoteIn, db: Session = Depends(get_db)):
    return build_quote(db, data)


@router.post("/checkout/orders", response_model=CreateOrderOut, status_code=201)
def create_order(data: CreateOrderIn, db: Session = Depends(get_db), x_session_id: str = Header("")):
    s = get_settings()
    q = build_quote(db, data)
    order = Order(
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
def verify(data: VerifyIn, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.razorpay_order_id == data.razorpay_order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if not payments.verify_payment_signature(data.razorpay_order_id, data.razorpay_payment_id,
                                             data.razorpay_signature):
        raise HTTPException(400, "Payment signature mismatch")
    mark_order_paid(db, order, data.razorpay_payment_id)
    db.add(PaymentEvent(event_id=f"verify:{data.razorpay_payment_id}", source="verify",
                        order_number=order.number, payload=data.model_dump()))
    try:
        db.commit()
    except IntegrityError:  # same payment verified twice — already recorded
        db.rollback()
    db.refresh(order)
    return order


@router.post("/checkout/mock-pay")
def mock_pay(payload: dict):
    """Simulates Razorpay Checkout's success callback. Disabled automatically when real keys are set."""
    if not get_settings().payments_mock:
        raise HTTPException(404)
    return payments.mock_sign(str(payload.get("razorpay_order_id", "")))


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db),
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
            mark_order_paid(db, order, payment.get("id", ""))
        elif event.get("event") == "payment.failed":
            mark_order_failed(order)
    db.add(PaymentEvent(event_id=event_id, source="webhook", order_number=order.number if order else "",
                        payload=event))
    db.commit()
    return {"ok": True}


@router.get("/orders/{number}", response_model=OrderOut)
def get_order(number: str, db: Session = Depends(get_db), x_session_id: str = Header("")):
    order = db.query(Order).filter(Order.number == number).first()
    if not order or (order.session_id and order.session_id != x_session_id):
        raise HTTPException(404, "Order not found")
    return order
