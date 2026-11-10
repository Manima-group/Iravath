"""Server-side pricing. The browser never decides a price — it only sends product ids, sizes and quantities."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Coupon, Product
from ..schemas import Quote, QuoteIn, QuoteLine

def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def coupon_is_live(c: Coupon, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    starts, ends = _aware(c.starts_at), _aware(c.ends_at)
    return c.is_active and (starts is None or starts <= now) and (ends is None or now <= ends)


def coupon_discount(c: Coupon, subtotal: int) -> int:
    amount = subtotal * c.value // 100 if c.kind == "percent" else c.value
    if c.max_discount:
        amount = min(amount, c.max_discount)
    return max(0, min(amount, subtotal))


def apply_coupon(db: Session, code: str, subtotal: int) -> tuple[int, str, str]:
    code = code.strip().upper()
    if not code:
        return 0, "", ""
    c = db.query(Coupon).filter(Coupon.code == code).first()
    if not c or not coupon_is_live(c):
        return 0, "", "Invalid or expired coupon code"
    if subtotal < c.min_subtotal:
        return 0, "", f"{code} needs a subtotal of ₹{c.min_subtotal:,}"
    return coupon_discount(c, subtotal), code, c.description or f"{code} applied"


def build_quote(db: Session, data: QuoteIn, *, check_stock: bool = True) -> Quote:
    s = get_settings()
    ids = {line.product_id for line in data.items}
    products = {p.id: p for p in db.query(Product).filter(Product.id.in_(ids), Product.is_active.is_(True)).all()}

    lines: list[QuoteLine] = []
    for line in data.items:
        p = products.get(line.product_id)
        if not p:
            raise HTTPException(404, f"Product {line.product_id} not found")
        if line.size not in p.sizes:
            raise HTTPException(422, f"Size {line.size} not offered for {p.name}")
        if check_stock and p.sizes[line.size] < line.quantity:
            raise HTTPException(409, f"Only {p.sizes[line.size]} left of {p.name} ({line.size})")
        lines.append(QuoteLine(product_id=p.id, name=p.name, size=line.size, quantity=line.quantity,
                               unit_price=p.price, line_total=p.price * line.quantity))

    subtotal = sum(l.line_total for l in lines)
    discount, coupon, coupon_msg = apply_coupon(db, data.coupon, subtotal)
    after_discount = subtotal - discount
    shipping = 0 if after_discount >= s.free_shipping_threshold else s.shipping_fee
    total = after_discount + shipping

    cod_available = total <= s.cod_max_order_value and total > s.cod_advance
    method = data.payment_method
    if method == "cod" and not cod_available:
        raise HTTPException(422, f"Cash on Delivery is available for orders up to ₹{s.cod_max_order_value:,}")
    pay_now, pay_on_delivery = (s.cod_advance, total - s.cod_advance) if method == "cod" else (total, 0)

    return Quote(lines=lines, subtotal=subtotal, discount=discount, coupon=coupon, coupon_message=coupon_msg,
                 shipping=shipping, total=total, payment_method=method, pay_now=pay_now,
                 pay_on_delivery=pay_on_delivery, cod_available=cod_available)
