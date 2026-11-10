import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import admin, catalog, checkout, wishlist
from .seed import seed

log = logging.getLogger("uvicorn.error")
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()  # creates tables + demo catalog on first boot
    if settings.admin_password == "iravath-admin":
        log.warning("ADMIN_PASSWORD is the default. Set ADMIN_PASSWORD and ADMIN_SECRET in .env before deploying.")
    yield


settings = get_settings()
app = FastAPI(title="Iravath Store API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

app.include_router(catalog.router)
app.include_router(wishlist.router)
app.include_router(checkout.router)
app.include_router(admin.public)
app.include_router(admin.router)

settings.media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")


@app.get("/api/health")
def health():
    return {"ok": True, "payments": "mock" if settings.payments_mock else "razorpay",
            "cod_advance": settings.cod_advance, "free_shipping_threshold": settings.free_shipping_threshold,
            "shipping_fee": settings.shipping_fee, "cod_max_order_value": settings.cod_max_order_value}


if FRONTEND_DIR.exists():  # serve the storefront from the same origin
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
