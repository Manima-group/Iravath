# Iravath Store

Premium menswear store: Next.js storefront (SEO), FastAPI backend, admin panel, Razorpay payments, Cash on Delivery (₹200 advance online, balance on delivery), email-OTP customer accounts, Shiprocket shipping, and order emails + WhatsApp.

```
storefront/  Next.js 16 storefront (App Router, ISR, SEO)          -> http://localhost:3000
backend/     FastAPI API                                          -> http://localhost:8000/api/...
admin/       Admin panel (static HTML/JS, served by the backend)  -> http://localhost:8000/admin.html
```

## Run locally

**1. Backend (API + admin)**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # leave Razorpay keys empty for mock payments
uvicorn app.main:app --reload --port 8000
```

On first boot, the tables and a catalogue of 16 products are created automatically. Admin: http://localhost:8000/admin.html

**2. Storefront (Next.js)**

```bash
cd storefront
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                    # http://localhost:3000
# production: npm run build && npm start
```

Without SMTP/WhatsApp/Shiprocket keys everything still works locally: emails and WhatsApp messages (including sign-in codes) are printed in the backend console, and Shiprocket returns mock AWB numbers.

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

## Customer accounts (email OTP)

- `/account`: customer enters an email and gets a 6-digit code (10-minute expiry, 5 wrong tries, 1 resend per 30s, 5 codes/hour). No passwords.
- On sign-in, the guest wishlist from that browser **merges** into the account (duplicates skipped) and past guest orders placed with the same email are linked. Orders are matched by the verified email only, never by browser, so shared computers stay safe.
- Signed-in shoppers get: wishlist on every device, saved address auto-filled at checkout, order history with tracking, WhatsApp opt-out.
- Customer tokens are signed with `CUSTOMER_SECRET` (separate from the admin secret), so they can never open admin routes.

## Orders, shipping and notifications

**Flow:** payment verified (browser or Razorpay webhook, whichever first, exactly once) → order confirmed email + WhatsApp → Shiprocket order + AWB created automatically → status `Packed`. Shiprocket's tracking webhook then moves it to Shipped → Out for delivery → Delivered (or RTO), and the customer is emailed/WhatsApped at each step.

**Admin → Orders tab:** filter by status/payment, search by order no./AWB/name/phone, open an order to see customer, items, payment, shipment and a full timeline. Change status (rules prevent invalid jumps such as Packed → Delivered), add courier/AWB manually, create or retry the Shiprocket shipment, add internal notes, resend any notification, export CSV. Cancelling restocks the items, cancels the Shiprocket order and reminds you to refund the online amount in Razorpay.

**Admin → COD tab (reconciliation):** COD amount awaiting delivery, collected-but-not-remitted, and remitted totals. Delivered COD orders are marked collected automatically (or mark manually, with short-collection warnings). When Shiprocket remits money to your bank, tick the orders in that remittance, enter the UTR, and mark them remitted in one go. CSV export for your accountant.

**Shiprocket setup:** create an API user (Shiprocket → Settings → API), set `SHIPROCKET_EMAIL/PASSWORD` and your pickup location name. Add a tracking webhook pointing to `{API_URL}/api/webhooks/shiprocket` with a token, and set the same token as `SHIPROCKET_WEBHOOK_TOKEN`. For partial COD the courier is told to collect only the balance (the ₹200 advance is sent as part of `total_discount`), so check the COD amount on your first live shipment.

**Email:** any SMTP provider (Zoho Mail, Google Workspace, Amazon SES, Brevo). Set `MAIL_FROM` to an address on your domain and add SPF/DKIM records so emails don't land in spam.

**WhatsApp:** Meta WhatsApp Cloud API. Create three utility templates and get them approved (`order_confirmed`, `order_shipped`, `order_delivered`); the parameters each needs are listed at the top of `backend/app/services/notify.py`.

## Storefront & SEO (Next.js)

- Clean URLs: `/shop`, `/shop/kurtas`, `/product/ivory-linen-shirt`, `/search?q=linen`.
- Product, category and home pages are server-rendered and cached (ISR, refreshed every 60s, or **instantly** after admin edits when `STOREFRONT_REVALIDATE_SECRET` / `REVALIDATE_SECRET` are set).
- Per-page titles, descriptions, canonical URLs, Open Graph/Twitter cards, `Product` + `BreadcrumbList` + `ItemList` + `ClothingStore` structured data, `sitemap.xml` (with product images), `robots.txt` (checkout/account/order pages excluded), web manifest.
- Real product photography via `next/image` (responsive sizes, WebP/AVIF). Products without photos show a branded Iravath placeholder until you upload pictures in the admin panel.
- Deploy on Vercel: set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `REVALIDATE_SECRET` (and optionally `API_URL_INTERNAL`). Submit `https://<your-domain>/sitemap.xml` in Google Search Console.

## Admin panel

Open **http://localhost:8000/admin.html** and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` (defaults: `admin@iravath.in` / `iravath-admin`; **change them and `ADMIN_SECRET` before going live**).

- **Products:** add/edit with up to 12 photos each (drag & drop or tap to upload from phone; first photo = cover; reorder with ← →). Set MRP + selling price (quick 10–50% off buttons), badge, fabric, colour, stock per size (S–XXL / waist / free-size presets), and show/hide in store. Photos are auto-rotated, resized to 1600px, EXIF/GPS stripped and saved as WebP in `MEDIA_DIR`.
- **Offers:** create coupons (percentage with optional cap, or flat ₹), minimum order, start/end schedule, pause/resume, and **Show in banner** to rotate the offer in the store's announcement bar.
- **Dashboard tiles:** live/hidden products, low stock, paid orders, revenue.
- Deleting a product that has past orders hides it instead, so order history stays intact.

Production notes: product photos live on local disk (`backend/media/`, not committed to Git), so on Render/ECS mount a persistent volume at `MEDIA_DIR` (or swap `services/images.py` to upload to S3/Supabase Storage). The admin is a single account protected by a signed 12-hour token; add staff users/roles when more people need access.

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
- **Storefront:** Vercel (root directory `storefront/`). Point `iravath.in` here.
- **Admin panel:** served by the backend at `https://api.iravath.in/admin.html` (set `SERVE_ADMIN_STATIC=false` to turn it off).
- Set `STORE_URL`, `API_URL`, `CORS_ORIGINS=["https://iravath.in"]` and all secrets (`ADMIN_PASSWORD`, `ADMIN_SECRET`, `CUSTOMER_SECRET`, `STOREFRONT_REVALIDATE_SECRET`) on the backend.
- Upgrading an existing database: new columns are added automatically on startup (`app/seed.py: NEW_COLUMNS`); new tables are created. Move to Alembic once the schema changes often.

## Next milestones

Returns/exchange requests from the account page, Razorpay refunds from the admin, product reviews, Shiprocket shipment creation on `paid`/`cod_confirmed`, order emails/WhatsApp, real product photography (replace `art()` in app.js with `<img>`), and SEO-friendly routes (Next.js) if organic traffic matters.
