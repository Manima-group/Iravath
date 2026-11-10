from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    app_name: str = "Iravath"
    # SQLite for local dev; set to your Supabase/Postgres URL in production, e.g.
    # postgresql+psycopg://postgres:password@localhost:5432/iravath
    database_url: str = f"sqlite:///{BASE_DIR / 'iravath.db'}"
    cors_origins: list[str] = ["*"]
    serve_admin_static: bool = True

    # Razorpay. Leave the keys empty to run in MOCK payment mode.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    mock_payment_secret: str = "iravath-mock-secret"

    # Pricing rules (all amounts in rupees)
    free_shipping_threshold: int = 1999
    shipping_fee: int = 99
    cod_advance: int = 200          # paid online now; balance collected on delivery
    cod_max_order_value: int = 10000
    currency: str = "INR"

    # Admin panel. CHANGE these in .env before deploying.
    admin_email: str = "admin@iravath.in"
    admin_password: str = "iravath-admin"
    admin_secret: str = "change-me-to-a-long-random-string"
    admin_token_hours: int = 12
    media_dir: Path = BASE_DIR / "media"
    max_upload_mb: int = 8

    # Public URLs (used in emails, sitemap, Shiprocket, CORS)
    store_url: str = "http://localhost:3000"
    api_url: str = "http://localhost:8000"
    storefront_revalidate_secret: str = ""   # same value as REVALIDATE_SECRET in storefront/.env

    # Customer accounts (email OTP)
    customer_secret: str = "change-me-customer-token-secret"
    customer_token_days: int = 30
    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_seconds: int = 30
    otp_max_per_hour: int = 5

    # Email over SMTP (Gmail/Zoho/SES/Brevo...). Empty SMTP_HOST = print emails to the console.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_ssl: bool = False      # True for port 465
    mail_from: str = "Iravath <orders@iravath.in>"
    admin_notify_email: str = ""    # gets a copy of every new order

    # WhatsApp Cloud API (Meta). Empty token = log only.
    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_lang: str = "en"
    # Approved template names; each takes body params documented in services/notify.py
    wa_tpl_order_confirmed: str = "order_confirmed"
    wa_tpl_order_shipped: str = "order_shipped"
    wa_tpl_order_delivered: str = "order_delivered"

    # Shiprocket. Empty email = mock mode (fake AWB numbers).
    shiprocket_email: str = ""
    shiprocket_password: str = ""
    shiprocket_pickup_location: str = "Primary"
    shiprocket_auto_create: bool = True   # create shipment when an order becomes paid / cod_confirmed
    shiprocket_auto_awb: bool = True      # also assign courier + AWB
    shiprocket_webhook_token: str = ""    # sent by Shiprocket in the x-api-key header
    package_weight_kg: float = 0.4       # per piece; parcel weight = this x number of pieces
    package_length_cm: int = 30
    package_breadth_cm: int = 25
    package_height_cm: int = 5

    @property
    def payments_mock(self) -> bool:
        return not (self.razorpay_key_id and self.razorpay_key_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
