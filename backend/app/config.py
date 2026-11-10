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

    @property
    def payments_mock(self) -> bool:
        return not (self.razorpay_key_id and self.razorpay_key_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
