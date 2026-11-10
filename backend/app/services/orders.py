from sqlalchemy.orm import Session

from ..models import Order, Product, utcnow


def mark_order_paid(db: Session, order: Order, payment_id: str) -> Order:
    """Idempotent: a verify call and a webhook may both arrive for the same payment."""
    if order.status in ("paid", "cod_confirmed"):
        return order
    order.status = "cod_confirmed" if order.payment_method == "cod" else "paid"
    order.razorpay_payment_id = payment_id
    order.paid_at = utcnow()
    for item in order.items:
        product = db.get(Product, item.product_id)
        if product:
            sizes = dict(product.sizes)
            sizes[item.size] = max(0, sizes.get(item.size, 0) - item.quantity)
            product.sizes = sizes
    return order


def mark_order_failed(order: Order) -> Order:
    if order.status == "pending_payment":
        order.status = "failed"
    return order
