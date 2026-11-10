"""Wishlist. Signed-in customers (Bearer customer token) get an account wishlist that follows them across
devices; guests get one keyed by the anonymous X-Session-Id header. Logging in merges the guest list
into the account (services/accounts.merge_guest_session)."""
import re

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Customer, Product, WishlistItem
from ..schemas import ProductOut
from ..services.customer_auth import optional_customer

router = APIRouter(prefix="/api/wishlist", tags=["wishlist"])


def account_key(customer_id: int) -> str:
    """Account rows get their own key so (session_id, product_id) never collides across people sharing a browser."""
    return f"cust-{customer_id}"


def session_id(x_session_id: str = Header(...)) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", x_session_id):
        raise HTTPException(400, "Bad session id")
    return x_session_id


def _scope(db: Session, sid: str, customer: Customer | None):
    q = db.query(WishlistItem)
    if customer:
        return q.filter(WishlistItem.customer_id == customer.id)
    return q.filter(WishlistItem.session_id == sid, WishlistItem.customer_id.is_(None))


@router.get("", response_model=list[ProductOut])
def get_wishlist(sid: str = Depends(session_id), db: Session = Depends(get_db),
                 customer: Customer | None = Depends(optional_customer)):
    rows = (_scope(db, sid, customer).options(joinedload(WishlistItem.product).joinedload(Product.category))
            .order_by(WishlistItem.created_at.desc()).all())
    return [r.product for r in rows if r.product.is_active]


@router.post("/{product_id}", status_code=201)
def add_to_wishlist(product_id: int, sid: str = Depends(session_id), db: Session = Depends(get_db),
                    customer: Customer | None = Depends(optional_customer)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "Product not found")
    if _scope(db, sid, customer).filter(WishlistItem.product_id == product_id).first():
        return {"ok": True}
    key = account_key(customer.id) if customer else sid
    db.add(WishlistItem(session_id=key, product_id=product_id, customer_id=customer.id if customer else None))
    db.commit()
    return {"ok": True}


@router.delete("/{product_id}")
def remove_from_wishlist(product_id: int, sid: str = Depends(session_id), db: Session = Depends(get_db),
                         customer: Customer | None = Depends(optional_customer)):
    _scope(db, sid, customer).filter(WishlistItem.product_id == product_id).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
