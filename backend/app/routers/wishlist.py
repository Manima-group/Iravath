"""Guest wishlist keyed by an anonymous X-Session-Id the browser generates and keeps in localStorage.
When accounts are added, merge rows from session_id -> user_id on login."""
import re

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Product, WishlistItem
from ..schemas import ProductOut

router = APIRouter(prefix="/api/wishlist", tags=["wishlist"])


def session_id(x_session_id: str = Header(...)) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", x_session_id):
        raise HTTPException(400, "Bad session id")
    return x_session_id


@router.get("", response_model=list[ProductOut])
def get_wishlist(sid: str = Depends(session_id), db: Session = Depends(get_db)):
    rows = (db.query(WishlistItem).options(joinedload(WishlistItem.product).joinedload(Product.category))
            .filter(WishlistItem.session_id == sid).order_by(WishlistItem.created_at.desc()).all())
    return [r.product for r in rows if r.product.is_active]


@router.post("/{product_id}", status_code=201)
def add_to_wishlist(product_id: int, sid: str = Depends(session_id), db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(404, "Product not found")
    exists = db.query(WishlistItem).filter_by(session_id=sid, product_id=product_id).first()
    if not exists:
        db.add(WishlistItem(session_id=sid, product_id=product_id))
        db.commit()
    return {"ok": True}


@router.delete("/{product_id}")
def remove_from_wishlist(product_id: int, sid: str = Depends(session_id), db: Session = Depends(get_db)):
    db.query(WishlistItem).filter_by(session_id=sid, product_id=product_id).delete()
    db.commit()
    return {"ok": True}
