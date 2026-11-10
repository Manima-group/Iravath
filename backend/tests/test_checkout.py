import hashlib
import hmac
import json
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["RAZORPAY_KEY_ID"] = ""
os.environ["RAZORPAY_KEY_SECRET"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

SID = {"X-Session-Id": "test-session-1234"}
CUSTOMER = {"name": "Sai Test", "email": "sai@example.com", "phone": "+91 98765 43210"}
ADDRESS = {"line1": "Plot 12, Jubilee Hills", "city": "Hyderabad", "state": "Telangana", "pincode": "500033"}


def client():
    return TestClient(app)


def test_catalog_and_filters():
    with client() as c:
        assert len(c.get("/api/categories").json()) == 6
        assert c.get("/api/products").json()["total"] == 16
        kurtas = c.get("/api/products", params={"category": "kurtas", "sort": "price_asc"}).json()["items"]
        assert [p["price"] for p in kurtas] == sorted(p["price"] for p in kurtas)
        assert c.get("/api/products/ivory-linen-shirt").json()["price"] == 2499


def test_wishlist_roundtrip():
    with client() as c:
        assert c.post("/api/wishlist/1", headers=SID).status_code == 201
        c.post("/api/wishlist/1", headers=SID)  # duplicate add is a no-op
        assert [p["id"] for p in c.get("/api/wishlist", headers=SID).json()] == [1]
        c.delete("/api/wishlist/1", headers=SID)
        assert c.get("/api/wishlist", headers=SID).json() == []


def test_quote_shipping_coupon_and_cod():
    with client() as c:
        q = c.post("/api/checkout/quote", json={"items": [{"product_id": 11, "size": "M", "quantity": 1}]}).json()
        assert (q["subtotal"], q["shipping"], q["total"]) == (999, 99, 1098)
        q = c.post("/api/checkout/quote", json={"items": [{"product_id": 1, "size": "M", "quantity": 1}],
                                                "coupon": "iravath10", "payment_method": "cod"}).json()
        assert q["discount"] == 249 and q["shipping"] == 0 and q["total"] == 2250
        assert (q["pay_now"], q["pay_on_delivery"]) == (200, 2050)
        too_big = {"items": [{"product_id": 13, "size": "M", "quantity": 2}], "payment_method": "cod"}
        assert c.post("/api/checkout/quote", json=too_big).status_code == 422


def test_online_order_payment_flow_and_stock():
    with client() as c:
        before = c.get("/api/products/ivory-linen-shirt").json()["sizes"]["L"]
        r = c.post("/api/checkout/orders", headers=SID, json={
            "items": [{"product_id": 1, "size": "L", "quantity": 2}], "payment_method": "online",
            "customer": CUSTOMER, "address": ADDRESS})
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["mock"] and o["amount_paise"] == 4998 * 100

        bad = {"razorpay_order_id": o["razorpay_order_id"], "razorpay_payment_id": "pay_x", "razorpay_signature": "nope"}
        assert c.post("/api/checkout/verify", json=bad).status_code == 400

        sig = c.post("/api/checkout/mock-pay", json={"razorpay_order_id": o["razorpay_order_id"]}).json()
        paid = c.post("/api/checkout/verify", json=sig).json()
        assert paid["status"] == "paid"
        assert c.post("/api/checkout/verify", json=sig).json()["status"] == "paid"  # idempotent
        assert c.get("/api/products/ivory-linen-shirt").json()["sizes"]["L"] == before - 2
        assert c.get(f"/api/orders/{o['order_number']}", headers=SID).status_code == 200
        assert c.get(f"/api/orders/{o['order_number']}", headers={"X-Session-Id": "someone-else"}).status_code == 404


def test_cod_order_and_webhook():
    with client() as c:
        o = c.post("/api/checkout/orders", headers=SID, json={
            "items": [{"product_id": 5, "size": "M", "quantity": 1}], "payment_method": "cod",
            "customer": CUSTOMER, "address": ADDRESS}).json()
        assert o["amount_paise"] == 200 * 100 and o["quote"]["pay_on_delivery"] == 3499 - 200

        event = {"event": "payment.captured", "created_at": 1,
                 "payload": {"payment": {"entity": {"id": "pay_wh_1", "order_id": o["razorpay_order_id"]}}}}
        body = json.dumps(event).encode()
        good = hmac.new(b"iravath-mock-secret", body, hashlib.sha256).hexdigest()
        assert c.post("/api/webhooks/razorpay", content=body, headers={"X-Razorpay-Signature": "bad"}).status_code == 400
        h = {"X-Razorpay-Signature": good, "X-Razorpay-Event-Id": "evt_1"}
        assert c.post("/api/webhooks/razorpay", content=body, headers=h).json() == {"ok": True}
        assert c.post("/api/webhooks/razorpay", content=body, headers=h).json()["duplicate"] is True
        assert c.get(f"/api/orders/{o['order_number']}", headers=SID).json()["status"] == "cod_confirmed"


def test_validation_errors():
    with client() as c:
        r = c.post("/api/checkout/orders", json={
            "items": [{"product_id": 1, "size": "M", "quantity": 1}],
            "customer": {**CUSTOMER, "phone": "12345"}, "address": {**ADDRESS, "pincode": "0123"}})
        assert r.status_code == 422
