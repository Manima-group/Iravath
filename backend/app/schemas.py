import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str
    blurb: str


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    name: str
    description: str
    price: int
    mrp: int
    fabric: str
    color: str
    color_hex: str
    silhouette: str
    rating: float
    reviews: int
    badge: str
    sizes: dict[str, int]
    images: list[str] = []
    is_active: bool = True
    category: CategoryOut


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int


class CartLine(BaseModel):
    product_id: int
    size: str
    quantity: int = Field(ge=1, le=10)


class QuoteIn(BaseModel):
    items: list[CartLine] = Field(min_length=1, max_length=50)
    coupon: str = ""
    payment_method: Literal["online", "cod"] = "online"


class QuoteLine(BaseModel):
    product_id: int
    name: str
    size: str
    quantity: int
    unit_price: int
    line_total: int


class Quote(BaseModel):
    lines: list[QuoteLine]
    subtotal: int
    discount: int
    coupon: str
    coupon_message: str
    shipping: int
    total: int
    payment_method: str
    pay_now: int
    pay_on_delivery: int
    cod_available: bool


class Customer(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=120)
    phone: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Enter a valid email")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v)[-10:]
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Enter a valid 10-digit Indian mobile number")
        return digits


class Address(BaseModel):
    line1: str = Field(min_length=3, max_length=200)
    line2: str = ""
    city: str = Field(min_length=2, max_length=80)
    state: str = Field(min_length=2, max_length=80)
    pincode: str

    @field_validator("pincode")
    @classmethod
    def _pin(cls, v: str) -> str:
        if not re.fullmatch(r"[1-9]\d{5}", v.strip()):
            raise ValueError("Enter a valid 6-digit PIN code")
        return v.strip()


class CreateOrderIn(QuoteIn):
    customer: Customer
    address: Address


class CreateOrderOut(BaseModel):
    order_number: str
    razorpay_order_id: str
    key_id: str
    amount_paise: int
    currency: str
    mock: bool
    quote: Quote
    prefill: dict


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    size: str
    unit_price: int
    quantity: int


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    kind: str
    message: str
    actor: str = "system"
    created_at: datetime


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    number: str
    status: str
    payment_method: str
    customer: dict
    address: dict
    subtotal: int
    discount: int
    shipping: int
    total: int
    pay_now: int
    pay_on_delivery: int
    coupon: str
    razorpay_payment_id: str
    items: list[OrderItemOut]
    created_at: datetime | None = None
    fulfilment_status: str = "unfulfilled"
    awb_code: str = ""
    courier_name: str = ""
    tracking_url: str = ""
    timeline: list["EventOut"] = []


# ---------- admin ----------
class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    token: str
    email: str
    expires_at: datetime


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = ""
    category: str  # category slug
    description: str = Field("", max_length=4000)
    price: int = Field(gt=0, le=10_00_000)
    mrp: int = Field(gt=0, le=10_00_000)
    fabric: str = Field("", max_length=120)
    color: str = Field("", max_length=40)
    color_hex: str = Field("#c8b48a", pattern=r"^#[0-9a-fA-F]{6}$")
    silhouette: Literal["shirt", "kurta", "trouser", "tee", "jacket", "square", "belt"] = "shirt"
    badge: str = Field("", max_length=30)
    sizes: dict[str, int] = Field(min_length=1)
    images: list[str] = Field(default_factory=list, max_length=12)
    is_active: bool = True

    @field_validator("sizes")
    @classmethod
    def _sizes(cls, v: dict[str, int]) -> dict[str, int]:
        clean = {}
        for k, n in v.items():
            k = k.strip().upper()
            if not k or len(k) > 10:
                raise ValueError("Size names must be 1-10 characters")
            if n < 0 or n > 100_000:
                raise ValueError("Stock must be between 0 and 100000")
            clean[k] = int(n)
        return clean

    @field_validator("mrp")
    @classmethod
    def _mrp(cls, v: int, info) -> int:
        price = info.data.get("price")
        if price and v < price:
            raise ValueError("MRP cannot be lower than the selling price")
        return v


class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    blurb: str = Field("", max_length=255)


class CouponIn(BaseModel):
    code: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    description: str = Field("", max_length=160)
    kind: Literal["percent", "flat"]
    value: int = Field(gt=0)
    min_subtotal: int = Field(0, ge=0)
    max_discount: int = Field(0, ge=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool = True
    show_in_banner: bool = False

    @field_validator("code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("value")
    @classmethod
    def _value(cls, v: int, info) -> int:
        if info.data.get("kind") == "percent" and v > 90:
            raise ValueError("Percent discount must be 90 or less")
        return v


class CouponOut(CouponIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    live: bool = False


class OfferOut(BaseModel):
    code: str
    description: str


# ---------- customer accounts ----------
class OtpRequestIn(BaseModel):
    email: str = Field(max_length=120)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Enter a valid email")
        return v


class OtpVerifyIn(OtpRequestIn):
    code: str = Field(pattern=r"^\s*\d{6}\s*$")


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    phone: str
    address: dict
    whatsapp_opt_in: bool


class CustomerUpdate(BaseModel):
    name: str = Field("", max_length=80)
    phone: str = ""
    address: Address | None = None
    whatsapp_opt_in: bool = True

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if not v:
            return ""
        digits = re.sub(r"\D", "", v)[-10:]
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Enter a valid 10-digit Indian mobile number")
        return digits


class LoginOut(BaseModel):
    token: str
    expires_at: datetime
    customer: CustomerOut
    merged: dict
    is_new: bool


class OrderSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    number: str
    status: str
    fulfilment_status: str
    payment_method: str
    total: int
    created_at: datetime
    items: list[OrderItemOut]


# ---------- admin orders ----------
class AdminOrderOut(OrderOut):
    id: int
    session_id: str = ""
    customer_id: int | None = None
    paid_at: datetime | None = None
    shipped_at: datetime | None = None
    delivered_at: datetime | None = None
    shiprocket_order_id: str = ""
    shiprocket_shipment_id: str = ""
    shipment_error: str = ""
    cod_collected: bool = False
    cod_collected_amount: int = 0
    cod_remitted: bool = False
    cod_remittance_utr: str = ""
    cod_remitted_at: datetime | None = None
    admin_note: str = ""
    events: list[EventOut] = []
    notifications: list[dict] = []


class StatusIn(BaseModel):
    status: Literal["unfulfilled", "processing", "shipped", "out_for_delivery", "delivered", "cancelled", "rto"]
    note: str = Field("", max_length=300)
    awb_code: str = Field("", max_length=40)
    courier_name: str = Field("", max_length=80)
    tracking_url: str = Field("", max_length=300)
    notify: bool = True


class CodIn(BaseModel):
    collected: bool | None = None
    collected_amount: int | None = Field(None, ge=0)
    remitted: bool | None = None
    utr: str = Field("", max_length=40)
    note: str = Field("", max_length=300)


class CodBulkIn(BaseModel):
    order_numbers: list[str] = Field(min_length=1, max_length=500)
    utr: str = Field(min_length=3, max_length=40)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=1000)
