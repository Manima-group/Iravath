import re
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..models import Category, Coupon, Order, OrderItem, Product
from ..schemas import (CategoryIn, CategoryOut, CouponIn, CouponOut, LoginIn, ProductIn, ProductOut, TokenOut)
from ..services.auth import check_credentials, create_token, require_admin
from ..services.images import delete_media_file, save_product_image
from ..services.pricing import coupon_is_live
from ..services.storefront import revalidate

public = APIRouter(prefix="/api/admin", tags=["admin"])
router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:110] or "item"


def unique_slug(db: Session, model, base: str, exclude_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        q = db.query(model).filter(model.slug == slug)
        if exclude_id:
            q = q.filter(model.id != exclude_id)
        if not q.first():
            return slug
        slug, n = f"{base}-{n}", n + 1


# ---------- auth ----------
@public.post("/login", response_model=TokenOut)
def login(data: LoginIn):
    if not check_credentials(data.email, data.password):
        raise HTTPException(401, "Wrong email or password")
    token, exp = create_token(data.email.strip().lower())
    return TokenOut(token=token, email=data.email.strip().lower(), expires_at=exp)


@router.get("/me")
def me(email: str = Depends(require_admin)):
    return {"email": email}


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    paid = db.query(Order).filter(Order.status.in_(["paid", "cod_confirmed"]))
    return {
        "products": len(products),
        "active": sum(p.is_active for p in products),
        "low_stock": sum(1 for p in products if p.is_active and sum(p.sizes.values()) <= 5),
        "orders": paid.count(),
        "revenue": paid.with_entities(func.coalesce(func.sum(Order.total), 0)).scalar(),
        "live_offers": sum(coupon_is_live(c) for c in db.query(Coupon).all()),
    }


# ---------- uploads ----------

# ---------- uploads ----------
@router.post(
    "/uploads",
    openapi_extra={
        "requestBody": {
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["files"],
                        "properties": {
                            "files": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "format": "binary",
                                },
                            }
                        },
                    }
                }
            }
        }
    },
)
async def upload_images(files: list[UploadFile] = File(...)):
    if len(files) > 10:
        raise HTTPException(
            status_code=422,
            detail="Upload up to 10 photos at a time"
        )

    return {
        "urls": [
            await save_product_image(f)
            for f in files
        ]
    }


# ---------- categories ----------
@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(data: CategoryIn, db: Session = Depends(get_db)):
    cat = Category(name=data.name.strip(), blurb=data.blurb.strip(),
                   slug=unique_slug(db, Category, slugify(data.name)))
    db.add(cat)
    db.commit()
    return cat


# ---------- products ----------
def _load(db: Session, product_id: int) -> Product:
    p = db.query(Product).options(joinedload(Product.category)).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    return p


def _apply(db: Session, p: Product, data: ProductIn) -> None:
    cat = db.query(Category).filter(Category.slug == data.category).first()
    if not cat:
        raise HTTPException(422, "Unknown category")
    for url in data.images:
        if not url.startswith("/media/products/"):
            raise HTTPException(422, "Images must be uploaded through the admin panel")
    removed = set(p.images or []) - set(data.images)
    p.name, p.category = data.name.strip(), cat
    p.slug = unique_slug(db, Product, slugify(data.slug or data.name), exclude_id=p.id)
    for field in ("description", "price", "mrp", "fabric", "color", "color_hex", "silhouette", "badge",
                  "sizes", "images", "is_active"):
        setattr(p, field, getattr(data, field))
    for url in removed:
        delete_media_file(url)


@router.get("/products", response_model=list[ProductOut])
def admin_products(db: Session = Depends(get_db), q: str = ""):
    query = db.query(Product).options(joinedload(Product.category))
    if q:
        query = query.filter(Product.name.ilike(f"%{q.strip()}%"))
    return query.order_by(Product.id.desc()).all()


@router.get("/products/{product_id}", response_model=ProductOut)
def admin_product(product_id: int, db: Session = Depends(get_db)):
    return _load(db, product_id)


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(data: ProductIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    p = Product(images=[], rating=0, reviews=0)
    _apply(db, p, data)
    db.add(p)
    db.commit()
    p = _load(db, p.id)
    background.add_task(revalidate, ["/", "/shop", f"/shop/{p.category.slug}", f"/product/{p.slug}"])
    return p


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    p = _load(db, product_id)
    old_slug = p.slug
    _apply(db, p, data)
    db.commit()
    p = _load(db, p.id)
    background.add_task(revalidate, ["/", "/shop", f"/shop/{p.category.slug}", f"/product/{p.slug}", f"/product/{old_slug}"])
    return p


@router.delete("/products/{product_id}")
def delete_product(product_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    p = _load(db, product_id)
    background.add_task(revalidate, ["/", "/shop", f"/shop/{p.category.slug}", f"/product/{p.slug}"])
    if db.query(OrderItem).filter(OrderItem.product_id == p.id).first():
        p.is_active = False  # keep order history intact
        db.commit()
        return {"ok": True, "archived": True}
    for url in p.images or []:
        delete_media_file(url)
    db.delete(p)
    db.commit()
    return {"ok": True, "archived": False}


# ---------- offers / coupons ----------
def _coupon_out(c: Coupon) -> CouponOut:
    out = CouponOut.model_validate(c)
    out.live = coupon_is_live(c)
    return out


@router.get("/coupons", response_model=list[CouponOut])
def list_coupons(db: Session = Depends(get_db)):
    return [_coupon_out(c) for c in db.query(Coupon).order_by(Coupon.id.desc()).all()]


@router.post("/coupons", response_model=CouponOut, status_code=201)
def create_coupon(data: CouponIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    background.add_task(revalidate, ["/"])
    if db.query(Coupon).filter(Coupon.code == data.code).first():
        raise HTTPException(409, f"Coupon {data.code} already exists")
    c = Coupon(**data.model_dump())
    db.add(c)
    db.commit()
    return _coupon_out(c)


@router.put("/coupons/{coupon_id}", response_model=CouponOut)
def update_coupon(coupon_id: int, data: CouponIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    background.add_task(revalidate, ["/"])
    c = db.get(Coupon, coupon_id)
    if not c:
        raise HTTPException(404, "Coupon not found")
    clash = db.query(Coupon).filter(Coupon.code == data.code, Coupon.id != coupon_id).first()
    if clash:
        raise HTTPException(409, f"Coupon {data.code} already exists")
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return _coupon_out(c)


@router.delete("/coupons/{coupon_id}")
def delete_coupon(coupon_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    background.add_task(revalidate, ["/"])
    c = db.get(Coupon, coupon_id)
    if c:
        db.delete(c)
        db.commit()
    return {"ok": True}
