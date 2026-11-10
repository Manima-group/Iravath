from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.models import NotificationLog

SID = {"X-Session-Id": "orders-test-browser"}
CUSTOMER = {"name": "Kiran Kumar", "email": "kiran@example.com", "phone": "9123456780"}
ADDRESS = {"line1": "Flat 4B, Banjara Hills", "city": "Hyderabad", "state": "Telangana", "pincode": "500034"}


def admin(c):
    s = get_settings()
    t = c.post("/api/admin/login", json={"email": s.admin_email, "password": s.admin_password}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def place(c, method="online", product_id=1, size="M", qty=1):
    o = c.post("/api/checkout/orders", headers=SID, json={
        "items": [{"product_id": product_id, "size": size, "quantity": qty}], "payment_method": method,
        "customer": CUSTOMER, "address": ADDRESS}).json()
    sig = c.post("/api/checkout/mock-pay", json={"razorpay_order_id": o["razorpay_order_id"]}).json()
    c.post("/api/checkout/verify", json=sig)
    return o["order_number"]


def test_payment_triggers_email_whatsapp_and_shipment():
    with TestClient(app) as c:
        h = admin(c)
        num = place(c)
        d = c.get(f"/api/admin/orders/{num}", headers=h).json()
        assert d["status"] == "paid" and d["fulfilment_status"] == "processing"
        assert d["shiprocket_shipment_id"].startswith("MOCK") and d["awb_code"].startswith("MOCKAWB")
        chans = {(n["channel"], n["event"], n["status"]) for n in d["notifications"]}
        assert ("email", "order_confirmed", "logged") in chans and ("whatsapp", "order_confirmed", "logged") in chans
        # webhook + verify for the same payment must not double-send
        with SessionLocal() as db:
            assert db.query(NotificationLog).filter_by(order_number=num, event="order_confirmed", channel="email").count() == 1
        assert any("AWB" in e["message"] for e in d["events"])


def test_status_flow_rules_and_notifications():
    with TestClient(app) as c:
        h = admin(c)
        num = place(c)
        r = c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "delivered"})
        assert r.status_code == 409  # processing -> delivered is not allowed
        r = c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "shipped", "note": "Handed to Delhivery"})
        assert r.status_code == 200 and r.json()["shipped_at"]
        c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "out_for_delivery"})
        d = c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "delivered"}).json()
        assert d["fulfilment_status"] == "delivered"
        assert [t["message"] for t in d["timeline"]] == ["Order confirmed", "Packed & ready to ship", "Shipped",
                                                         "Out for delivery", "Delivered"]
        d = c.get(f"/api/admin/orders/{num}", headers=h).json()  # notifications are sent after the response
        events = {n["event"] for n in d["notifications"]}
        assert {"order_shipped", "out_for_delivery", "order_delivered"} <= events
        assert c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "cancelled"}).status_code == 409
        # customer-visible order page shows tracking + timeline
        pub = c.get(f"/api/orders/{num}", headers=SID).json()
        assert pub["awb_code"] and pub["timeline"][-1]["message"] == "Delivered"


def test_cancel_restocks():
    with TestClient(app) as c:
        h = admin(c)
        before = c.get("/api/products/sandstone-oxford-shirt").json()["sizes"]["XL"]
        num = place(c, product_id=2, size="XL", qty=2)
        assert c.get("/api/products/sandstone-oxford-shirt").json()["sizes"]["XL"] == before - 2
        d = c.post(f"/api/admin/orders/{num}/status", headers=h, json={"status": "cancelled", "note": "Customer asked"}).json()
        assert c.get("/api/products/sandstone-oxford-shirt").json()["sizes"]["XL"] == before
        assert any("Refund" in e["message"] for e in d["events"])


def test_cod_reconciliation_and_shiprocket_webhook():
    with TestClient(app) as c:
        h = admin(c)
        a, b = place(c, "cod", product_id=5), place(c, "cod", product_id=6)
        s = c.get("/api/admin/cod/summary", headers=h).json()
        assert s["awaiting_delivery"]["count"] >= 2

        # webhook: bad token rejected, then courier marks A delivered -> COD auto-collected
        awb = c.get(f"/api/admin/orders/{a}", headers=h).json()["awb_code"]
        assert c.post("/api/webhooks/shiprocket", json={"awb": awb, "current_status": "DELIVERED"}).status_code == 401
        hook = {"x-api-key": "test-hook-token"}
        assert c.post("/api/webhooks/shiprocket", headers=hook, json={"awb": awb, "current_status": "IN TRANSIT"}).json()["matched"]
        c.post("/api/webhooks/shiprocket", headers=hook, json={"awb": awb, "current_status": "DELIVERED"})
        da = c.get(f"/api/admin/orders/{a}", headers=h).json()
        assert da["fulfilment_status"] == "delivered" and da["cod_collected"] and da["cod_collected_amount"] == 3499 - 200
        # stale webhook can't move it backwards
        c.post("/api/webhooks/shiprocket", headers=hook, json={"awb": awb, "current_status": "IN TRANSIT"})
        assert c.get(f"/api/admin/orders/{a}", headers=h).json()["fulfilment_status"] == "delivered"

        # B: manual collection with a short amount, remit needs collection + UTR
        assert c.post(f"/api/admin/orders/{b}/cod", headers=h, json={"remitted": True, "utr": "X1"}).status_code == 409
        db_ = c.post(f"/api/admin/orders/{b}/cod", headers=h, json={"collected": True, "collected_amount": 3000}).json()
        assert any("Short/excess" in e["message"] for e in db_["events"])
        assert c.post(f"/api/admin/orders/{b}/cod", headers=h, json={"remitted": True}).status_code == 422

        r = c.post("/api/admin/cod/remit", headers=h, json={"order_numbers": [a, b, "IRVNOPE"], "utr": "UTR2611100042"}).json()
        assert sorted(r["remitted"]) == sorted([a, b]) and r["amount"] == 3299 + 3000
        s2 = c.get("/api/admin/cod/summary", headers=h).json()
        assert b in s2["short_collections"]
        csv_text = c.get("/api/admin/orders.csv?cod=remitted", headers=h).text
        assert "UTR2611100042" in csv_text and a in csv_text

        lst = c.get("/api/admin/orders", headers=h, params={"q": "Kiran"}).json()
        assert lst["total"] >= 2
        assert c.get("/api/admin/orders", headers=h, params={"cod": "remitted"}).json()["total"] >= 2


def test_admin_orders_need_auth():
    with TestClient(app) as c:
        assert c.get("/api/admin/orders").status_code == 401
        assert c.get("/api/admin/cod/summary").status_code == 401
