import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import accounts, admin, admin_orders, catalog, checkout, wishlist
from .seed import seed

log = logging.getLogger("uvicorn.error")
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    seed()  # creates tables + demo catalog on first boot
    if settings.admin_password == "iravath-admin":
        log.warning("ADMIN_PASSWORD is the default. Set ADMIN_PASSWORD and ADMIN_SECRET in .env before deploying.")
    if settings.customer_secret.startswith("change-me"):
        log.warning("CUSTOMER_SECRET is the default. Set a long random value in .env before deploying.")
    for name, off in (("Email (SMTP)", not settings.smtp_host), ("WhatsApp", not settings.whatsapp_token),
                      ("Shiprocket", not settings.shiprocket_email)):
        if off:
            log.warning("%s not configured: messages/shipments are logged or mocked.", name)
    yield


settings = get_settings()
app = FastAPI(title="Iravath Store API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])

app.include_router(catalog.router)
app.include_router(wishlist.router)
app.include_router(checkout.router)
app.include_router(admin.public)
app.include_router(admin.router)
app.include_router(admin_orders.router)
app.include_router(admin_orders.hooks)
app.include_router(accounts.router)

settings.media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")


@app.get("/api/health")
def health():
    return {"ok": True, "payments": "mock" if settings.payments_mock else "razorpay",
            "cod_advance": settings.cod_advance, "free_shipping_threshold": settings.free_shipping_threshold,
            "shipping_fee": settings.shipping_fee, "cod_max_order_value": settings.cod_max_order_value,
            "store_url": settings.store_url}


@app.get("/", include_in_schema=False)
def root():
    # The storefront is the Next.js app (storefront/). This server hosts the API and the admin panel.
    return RedirectResponse("/admin.html")


@app.middleware("http")
async def no_cache_admin_html(request, call_next):
    """Always fetch a fresh admin.html so new ?v= asset versions are picked up after updates."""
    response = await call_next(request)
    if request.url.path in ("/admin.html", "/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


if settings.serve_admin_static and FRONTEND_DIR.exists():  # admin panel (admin.html) + its assets
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="admin")
