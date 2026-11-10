from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    blurb: Mapped[str] = mapped_column(String(255), default="")
    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    price: Mapped[int] = mapped_column(Integer)          # selling price, rupees
    mrp: Mapped[int] = mapped_column(Integer)            # strike-through price
    fabric: Mapped[str] = mapped_column(String(120), default="")
    color: Mapped[str] = mapped_column(String(40), default="")
    color_hex: Mapped[str] = mapped_column(String(9), default="#c8b48a")
    silhouette: Mapped[str] = mapped_column(String(20), default="shirt")
    rating: Mapped[float] = mapped_column(Float, default=4.5)
    reviews: Mapped[int] = mapped_column(Integer, default=0)
    badge: Mapped[str] = mapped_column(String(30), default="")
    sizes: Mapped[dict] = mapped_column(JSON, default=dict)  # {"M": 12, "L": 0, ...} stock per size
    images: Mapped[list] = mapped_column(JSON, default=list)  # ["/media/products/abc.webp", ...] first = cover
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    category: Mapped[Category] = relationship(back_populates="products")


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("session_id", "product_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    product: Mapped[Product] = relationship()


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    # pending_payment -> paid (online) | cod_confirmed (COD advance paid) ; failed ; cancelled
    status: Mapped[str] = mapped_column(String(30), default="pending_payment", index=True)
    payment_method: Mapped[str] = mapped_column(String(10))  # online | cod
    customer: Mapped[dict] = mapped_column(JSON)
    address: Mapped[dict] = mapped_column(JSON)
    subtotal: Mapped[int] = mapped_column(Integer)
    discount: Mapped[int] = mapped_column(Integer, default=0)
    shipping: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer)
    pay_now: Mapped[int] = mapped_column(Integer)
    pay_on_delivery: Mapped[int] = mapped_column(Integer, default=0)
    coupon: Mapped[str] = mapped_column(String(30), default="")
    razorpay_order_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    razorpay_payment_id: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    name: Mapped[str] = mapped_column(String(200))
    size: Mapped[str] = mapped_column(String(10))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    order: Mapped[Order] = relationship(back_populates="items")


class PaymentEvent(Base):
    """Audit log of every verify/webhook hit — also gives webhook idempotency."""
    __tablename__ = "payment_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(80), unique=True)
    source: Mapped[str] = mapped_column(String(20))  # verify | webhook
    order_number: Mapped[str] = mapped_column(String(20), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Coupon(Base):
    """Offers managed from the admin panel. show_in_banner puts the offer in the storefront announcement bar."""
    __tablename__ = "coupons"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(160), default="")
    kind: Mapped[str] = mapped_column(String(10))           # percent | flat
    value: Mapped[int] = mapped_column(Integer)
    min_subtotal: Mapped[int] = mapped_column(Integer, default=0)
    max_discount: Mapped[int] = mapped_column(Integer, default=0)  # 0 = no cap
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    show_in_banner: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
