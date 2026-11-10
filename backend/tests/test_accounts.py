import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import accounts as accounts_router

SENT: dict[str, str] = {}


@pytest.fixture(autouse=True)
def capture_otp(monkeypatch):
    monkeypatch.setattr(accounts_router, "_send_otp", lambda email, code: SENT.__setitem__(email, code))


def login(c, email, sid):
    assert c.post("/api/auth/otp/request", json={"email": email}).status_code == 200
    r = c.post("/api/auth/otp/verify", json={"email": email, "code": SENT[email.lower()]}, headers={"X-Session-Id": sid})
    assert r.status_code == 200, r.text
    return r.json()


def test_otp_errors_and_limits():
    with TestClient(app) as c:
        assert c.post("/api/auth/otp/request", json={"email": "nope"}).status_code == 422
        c.post("/api/auth/otp/request", json={"email": "limit@example.com"})
        good = SENT["limit@example.com"]
        bad = "000000" if good != "000000" else "111111"
        for left in (4, 3):
            r = c.post("/api/auth/otp/verify", json={"email": "limit@example.com", "code": bad})
            assert r.status_code == 400 and f"{left} attempts left" in r.json()["detail"]
        # a new code invalidates the old one
        c.post("/api/auth/otp/request", json={"email": "limit@example.com"})
        if SENT["limit@example.com"] != good:
            assert c.post("/api/auth/otp/verify", json={"email": "limit@example.com", "code": good}).status_code == 400
        assert c.post("/api/auth/otp/verify", json={"email": "limit@example.com",
                                                    "code": SENT["limit@example.com"]}).status_code == 200
        # code can't be reused
        assert c.post("/api/auth/otp/verify", json={"email": "limit@example.com",
                                                    "code": SENT["limit@example.com"]}).status_code == 400
        codes = [c.post("/api/auth/otp/request", json={"email": "flood@example.com"}).status_code for _ in range(6)]
        assert codes == [200] * 5 + [429]  # 5 codes per hour


def test_login_merges_guest_wishlist_and_orders():
    with TestClient(app) as c:
        guest = {"X-Session-Id": "guest-browser-123"}
        c.post("/api/wishlist/2", headers=guest)
        c.post("/api/wishlist/3", headers=guest)
        # an earlier guest order with the same email
        o = c.post("/api/checkout/orders", headers=guest, json={
            "items": [{"product_id": 11, "size": "M", "quantity": 1}], "payment_method": "online",
            "customer": {"name": "Arjun Rao", "email": "Arjun@Example.com", "phone": "9876543210"},
            "address": {"line1": "12 Road No 5", "city": "Hyderabad", "state": "Telangana", "pincode": "500034"}}).json()
        c.post("/api/checkout/verify", json=c.post("/api/checkout/mock-pay", json={"razorpay_order_id": o["razorpay_order_id"]}).json())

        # account already has product 3 from another device
        first = login(c, "arjun@example.com", "phone-browser-999")
        auth = {"Authorization": f"Bearer {first['token']}", "X-Session-Id": "phone-browser-999"}
        c.post("/api/wishlist/3", headers=auth)

        res = login(c, "ARJUN@example.com", "guest-browser-123")
        assert res["is_new"] is False
        assert res["merged"]["wishlist_merged"] == 1 and res["merged"]["wishlist_duplicates"] == 1
        auth = {"Authorization": f"Bearer {res['token']}", "X-Session-Id": "guest-browser-123"}
        assert sorted(p["id"] for p in c.get("/api/wishlist", headers=auth).json()) == [2, 3]
        # same account wishlist on another device, guest list on this browser is now empty
        other = {"Authorization": f"Bearer {res['token']}", "X-Session-Id": "laptop-browser-777"}
        assert sorted(p["id"] for p in c.get("/api/wishlist", headers=other).json()) == [2, 3]
        assert c.get("/api/wishlist", headers=guest).json() == []

        orders = c.get("/api/account/orders", headers=auth).json()
        assert [x["number"] for x in orders] == [o["order_number"]]
        assert c.get(f"/api/account/orders/{o['order_number']}", headers=auth).json()["timeline"][0]["message"] == "Order confirmed"

        # profile
        r = c.put("/api/account/me", headers=auth, json={"name": "Arjun Rao", "phone": "+91 98765 43210",
                  "address": {"line1": "12 Road No 5", "city": "Hyderabad", "state": "Telangana", "pincode": "500034"}})
        assert r.json()["phone"] == "9876543210"


def test_customer_token_is_not_an_admin_token():
    with TestClient(app) as c:
        res = login(c, "sneaky@example.com", "sneaky-browser-1")
        assert c.get("/api/admin/products", headers={"Authorization": f"Bearer {res['token']}"}).status_code == 401
        assert c.get("/api/account/me", headers={"Authorization": "Bearer junk.sig"}).status_code == 401
        assert c.get("/api/account/me").status_code == 401
