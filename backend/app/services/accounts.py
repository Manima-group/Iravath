"""Email OTP login + merging the guest session (wishlist, orders) into the account."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Customer, Order, OtpCode, WishlistItem, utcnow


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _hash(email: str, code: str) -> str:
    key = get_settings().customer_secret.encode()
    return hmac.new(key, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def issue_otp(db: Session, email: str) -> str:
    """Creates a code and returns it (the caller emails it). Enforces resend + hourly limits."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    recent = (db.query(OtpCode).filter(OtpCode.email == email, OtpCode.created_at >= now - timedelta(hours=1))
              .order_by(OtpCode.created_at.desc()).all())
    if recent and (now - _aware(recent[0].created_at)).total_seconds() < s.otp_resend_seconds:
        wait = s.otp_resend_seconds - int((now - _aware(recent[0].created_at)).total_seconds())
        raise HTTPException(429, f"Please wait {wait}s before requesting another code")
    if len(recent) >= s.otp_max_per_hour:
        raise HTTPException(429, "Too many codes requested. Try again in an hour.")
    for old in recent:  # only the newest code is valid
        old.consumed = True
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(OtpCode(email=email, code_hash=_hash(email, code), expires_at=now + timedelta(minutes=s.otp_ttl_minutes)))
    db.commit()
    return code


def check_otp(db: Session, email: str, code: str) -> None:
    s = get_settings()
    otp = (db.query(OtpCode).filter(OtpCode.email == email, OtpCode.consumed.is_(False))
           .order_by(OtpCode.created_at.desc()).first())
    if not otp or _aware(otp.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(400, "Code expired. Request a new one.")
    if otp.attempts >= s.otp_max_attempts:
        raise HTTPException(429, "Too many wrong attempts. Request a new code.")
    if not hmac.compare_digest(otp.code_hash, _hash(email, code.strip())):
        otp.attempts += 1
        db.commit()
        left = s.otp_max_attempts - otp.attempts
        raise HTTPException(400, f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left." if left else
                            "Too many wrong attempts. Request a new code.")
    otp.consumed = True
    db.commit()


def get_or_create_customer(db: Session, email: str) -> tuple[Customer, bool]:
    c = db.query(Customer).filter(Customer.email == email).first()
    if c:
        return c, False
    c = Customer(email=email)
    db.add(c)
    db.flush()
    return c, True


def merge_guest_session(db: Session, customer: Customer, session_id: str) -> dict:
    """Move this browser's guest wishlist into the account (skipping duplicates) and link
    guest orders placed with the same (now verified) email. Orders are matched by email only,
    never by browser session, so a shared computer can't expose someone else's orders."""
    moved = dupes = 0
    have = {w.product_id for w in db.query(WishlistItem).filter(WishlistItem.customer_id == customer.id)}
    if session_id:
        for row in db.query(WishlistItem).filter(WishlistItem.session_id == session_id,
                                                 WishlistItem.customer_id.is_(None)).all():
            if row.product_id in have:
                db.delete(row)
                dupes += 1
            else:
                row.customer_id, row.session_id = customer.id, f"cust-{customer.id}"
                have.add(row.product_id)
                moved += 1
    orders = db.query(Order).filter(Order.customer_id.is_(None)).all()
    claimed = 0
    for o in orders:
        if (o.customer or {}).get("email", "").lower() == customer.email:
            o.customer_id = customer.id
            claimed += 1
    customer.last_login_at = utcnow()
    db.commit()
    return {"wishlist_merged": moved, "wishlist_duplicates": dupes, "orders_linked": claimed}
