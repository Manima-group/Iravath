from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Customer, Order
from ..schemas import (CustomerOut, CustomerUpdate, LoginOut, OrderOut, OrderSummaryOut, OtpRequestIn, OtpVerifyIn)
from ..services import notify
from ..services.accounts import check_otp, get_or_create_customer, issue_otp, merge_guest_session
from ..services.customer_auth import create_customer_token, require_customer
from .checkout import order_out

router = APIRouter(prefix="/api", tags=["accounts"])


def _send_otp(email: str, code: str) -> None:
    notify.send_email(email, *notify.render_otp_email(code))


@router.post("/auth/otp/request")
def request_otp(data: OtpRequestIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Always answers the same way whether or not the email has an account (no account enumeration)."""
    code = issue_otp(db, data.email)
    background.add_task(_send_otp, data.email, code)
    return {"ok": True, "message": f"We've sent a 6-digit code to {data.email}"}


@router.post("/auth/otp/verify", response_model=LoginOut)
def verify_otp(data: OtpVerifyIn, db: Session = Depends(get_db), x_session_id: str = Header("")):
    check_otp(db, data.email, data.code)
    customer, is_new = get_or_create_customer(db, data.email)
    merged = merge_guest_session(db, customer, x_session_id[:64])
    token, exp = create_customer_token(customer.id)
    return LoginOut(token=token, expires_at=exp, customer=customer, merged=merged, is_new=is_new)


@router.get("/account/me", response_model=CustomerOut)
def me(customer: Customer = Depends(require_customer)):
    return customer


@router.put("/account/me", response_model=CustomerOut)
def update_me(data: CustomerUpdate, customer: Customer = Depends(require_customer), db: Session = Depends(get_db)):
    customer.name = data.name.strip()
    customer.phone = data.phone
    customer.whatsapp_opt_in = data.whatsapp_opt_in
    if data.address is not None:
        customer.address = data.address.model_dump()
    db.add(customer)
    db.commit()
    return customer


@router.get("/account/orders", response_model=list[OrderSummaryOut])
def my_orders(customer: Customer = Depends(require_customer), db: Session = Depends(get_db)):
    return (db.query(Order).filter(Order.customer_id == customer.id, Order.status != "pending_payment")
            .order_by(Order.id.desc()).limit(100).all())


@router.get("/account/orders/{number}", response_model=OrderOut)
def my_order(number: str, customer: Customer = Depends(require_customer), db: Session = Depends(get_db)):
    o = db.query(Order).filter(Order.number == number, Order.customer_id == customer.id).first()
    if not o:
        raise HTTPException(404, "Order not found")
    return order_out(o)
