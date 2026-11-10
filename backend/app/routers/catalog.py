from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Category, Coupon, Product
from ..schemas import CategoryOut, OfferOut, ProductOut, ProductPage
from ..services.pricing import coupon_is_live

router = APIRouter(prefix="/api", tags=["catalog"])

SORTS = {
    "featured": Product.id.asc(),
    "newest": Product.created_at.desc(),
    "price_asc": Product.price.asc(),
    "price_desc": Product.price.desc(),
    "rating": Product.rating.desc(),
}


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.id).all()


@router.get("/products", response_model=ProductPage)
def list_products(
    db: Session = Depends(get_db),
    category: str | None = None,
    q: str | None = Query(None, max_length=80),
    min_price: int | None = None,
    max_price: int | None = None,
    sort: Literal["featured", "newest", "price_asc", "price_desc", "rating"] = "featured",
    limit: int = Query(24, le=100),
    offset: int = 0,
):
    query = db.query(Product).options(joinedload(Product.category)).filter(Product.is_active.is_(True))
    if category:
        query = query.join(Category).filter(Category.slug == category)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Product.name.ilike(like), Product.fabric.ilike(like), Product.color.ilike(like)))
    if min_price is not None:
        query = query.filter(Product.price >= min_price)
    if max_price is not None:
        query = query.filter(Product.price <= max_price)
    total = query.count()
    items = query.order_by(SORTS[sort]).offset(offset).limit(limit).all()
    return ProductPage(items=items, total=total)


@router.get("/products/{slug}", response_model=ProductOut)
def get_product(slug: str, db: Session = Depends(get_db)):
    product = db.query(Product).options(joinedload(Product.category)).filter(Product.slug == slug).first()
    if not product or not product.is_active:
        raise HTTPException(404, "Product not found")
    return product


@router.get("/offers", response_model=list[OfferOut])
def offers(db: Session = Depends(get_db)):
    """Live offers flagged for the storefront announcement bar."""
    rows = db.query(Coupon).filter(Coupon.show_in_banner.is_(True)).order_by(Coupon.id).all()
    return [OfferOut(code=c.code, description=c.description) for c in rows if coupon_is_live(c)]


@router.get("/sitemap-data")
def sitemap_data(db: Session = Depends(get_db)):
    """Everything the storefront's sitemap.xml needs in one call."""
    products = db.query(Product).filter(Product.is_active.is_(True)).all()
    return {
        "products": [{"slug": p.slug, "updated_at": p.created_at.isoformat() if p.created_at else None,
                      "image": (p.images or [None])[0]} for p in products],
        "categories": [c.slug for c in db.query(Category).all()],
    }
