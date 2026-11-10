# Iravath Store

Premium menswear storefront with a wishlist, cart, coupons, Razorpay payments and Cash on Delivery (₹200 advance online, balance on delivery).

```
backend/   FastAPI + SQLAlchemy (SQLite by default, Postgres/Supabase via DATABASE_URL)
frontend/  Vanilla JS storefront (served by FastAPI at "/")
```

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # leave Razorpay keys empty for mock payments
uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000. On first boot, the tables and a catalogue of 16 products are created automatically.

Run the tests with `pytest -q`. They cover pricing, coupons, the COD split, signature verification, webhook idempotency and stock decrements.

## Go live with Razorpay

1. In the Razorpay Dashboard, go to **Settings → API Keys** and generate test keys. Put them in `.env` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. In **Settings → Webhooks**, add `https://<your-api>/api/webhooks/razorpay` with the events `payment.captured`, `payment.failed` and `order.paid`. Copy the secret into `RAZORPAY_WEBHOOK_SECRET`.
3. Restart the server. `/api/health` should now report `"payments": "razorpay"`, and checkout opens the real Razorpay window (UPI, cards, net banking, wallets).
4. Once the test-mode payments work, switch to live keys.

### Payment flow

```
Browser                         FastAPI                              Razorpay
 POST /api/checkout/orders  ──▶  price cart server-side, save Order ─▶ orders.create(amount)
                            ◀──  razorpay_order_id, key_id, amount
 Razorpay Checkout (modal)  ─────────────────────────────────────────▶ customer pays
 handler(payment_id, signature)
 POST /api/checkout/verify  ──▶  HMAC_SHA256(order_id|payment_id) == signature → status=paid / cod_confirmed, stock--
                                 POST /api/webhooks/razorpay  ◀────── payment.captured (backup, idempotent)
```

Prices are never trusted from the browser. The server re-prices every cart from the database.

## Admin panel

Open **http://localhost:8000/admin.html** and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (defaults: `admin@iravath.in` / `iravath-admin`; **change them and `ADMIN_SECRET` before going live**).

- **Products:** add/edit with up to 12 photos each (drag & drop or tap to upload from phone; first photo = cover; reorder with ← →). Set MRP + selling price (quick 10–50% off buttons), badge, fabric, colour, stock per size (S–XXL / waist / free-size presets), and show/hide in store. Photos are auto-rotated, resized to 1600px, EXIF/GPS stripped and saved as WebP in `MEDIA_DIR`.
- **Offers:** create coupons (percentage with optional cap, or flat ₹), minimum order, start/end schedule, pause/resume, and **Show in banner** to rotate the offer in the store's announcement bar.
- **Dashboard tiles:** live/hidden products, low stock, paid orders, revenue.
- Deleting a product that has past orders hides it instead, so order history stays intact.

Production notes: product photos live on local disk, so on Render/ECS mount a persistent volume at `MEDIA_DIR` (or swap `services/images.py` to upload to S3/Supabase Storage). The admin is a single account protected by a signed 12-hour token; add staff users/roles when more people need access.

## Business rules (backend/app/config.py, overridable in .env)

| Rule                    | Default                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Free shipping threshold | ₹1,999 (else ₹99)                                                                                   |
| COD advance paid online | ₹200, which counts toward the order total                                                            |
| COD max order value     | ₹10,000                                                                                              |
| Coupons                 | Managed in the admin panel (seeded: `IRAVATH10` 10% up to ₹500, `WELCOME200` ₹200 off ₹1,499+) |

## API

| Method          | Path                                                         |                                                       |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| GET             | /api/categories                                              |                                                       |
| GET             | /api/products?category=&q=&sort=&min_price=&max_price=       | sort: featured, newest, rating, price_asc, price_desc |
| GET             | /api/products/{slug}                                         |                                                       |
| GET/POST/DELETE | /api/wishlist[/{product_id}]                                 | guest wishlist keyed by `X-Session-Id` header       |
| POST            | /api/checkout/quote                                          | totals, discount, shipping, COD split                 |
| POST            | /api/checkout/orders                                         | creates the order and the Razorpay order              |
| POST            | /api/checkout/verify                                         | verifies the checkout signature                       |
| POST            | /api/webhooks/razorpay                                       | signature-checked and idempotent                      |
| GET             | /api/orders/{number}                                         |                                                       |
| GET             | /api/offers                                                  | live offers for the announcement bar                  |
| POST            | /api/admin/login                                             | returns a bearer token                                |
| *               | /api/admin/products, /uploads, /categories, /coupons, /stats | admin only (Bearer token)                             |

Interactive docs are at http://localhost:8000/docs.

## Deploy

- **Backend:** Render or AWS ECS with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `DATABASE_URL=postgresql+psycopg://…` (Supabase) and run `pip install psycopg[binary]`.
- **Frontend:** it is served by the API. To host it separately (Vercel or Netlify), add `<script>window.IRAVATH_API_BASE="https://api.iravath.com"</script>` before `app.js` and set `CORS_ORIGINS`.
- Without a reachable API, the frontend falls back to an in-browser demo mode with simulated payments. This is handy for previews.

## Next milestones

Customer accounts (OTP login) with wishlist merge, admin order management (status updates, COD reconciliation), Shiprocket shipment creation on `paid`/`cod_confirmed`, order emails/WhatsApp, real product photography (replace `art()` in app.js with `<img>`), and SEO-friendly routes (Next.js) if organic traffic matters.
