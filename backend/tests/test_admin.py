import io
import os
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("MEDIA_DIR", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402


def login(c):
    s = get_settings()
    r = c.post("/api/admin/login", json={"email": s.admin_email, "password": s.admin_password})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def jpeg_bytes(w=2400, h=3000):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (176, 138, 62)).save(buf, "JPEG")
    return buf.getvalue()


def test_auth_required_and_bad_login():
    with TestClient(app) as c:
        assert c.get("/api/admin/products").status_code == 401
        assert c.get("/api/admin/products", headers={"Authorization": "Bearer x.y"}).status_code == 401
        assert c.post("/api/admin/login", json={"email": "admin@iravath.in", "password": "nope"}).status_code == 401


def test_product_lifecycle_with_photos():
    with TestClient(app) as c:
        h = login(c)
        # upload: resized to <=1600px and stored as webp
        r = c.post("/api/admin/uploads", headers=h, files=[("files", ("a.jpg", jpeg_bytes(), "image/jpeg")),
                                                           ("files", ("b.jpg", jpeg_bytes(800, 1000), "image/jpeg"))])
        assert r.status_code == 200, r.text
        urls = r.json()["urls"]
        assert len(urls) == 2 and all(u.endswith(".webp") for u in urls)
        img = c.get(urls[0])
        assert img.status_code == 200 and max(Image.open(io.BytesIO(img.content)).size) == 1600
        bad = c.post("/api/admin/uploads", headers=h, files=[("files", ("x.jpg", b"not an image", "image/jpeg"))])
        assert bad.status_code == 415

        body = {"name": "Saffron Silk Kurta", "category": "kurtas", "price": 2999, "mrp": 3999,
                "sizes": {"m": 5, "L": 3}, "images": urls, "badge": "New", "description": "Festive."}
        assert c.post("/api/admin/products", headers=h, json={**body, "mrp": 100}).status_code == 422
        p = c.post("/api/admin/products", headers=h, json=body).json()
        assert p["slug"] == "saffron-silk-kurta" and p["sizes"] == {"M": 5, "L": 3} and p["images"] == urls

        # visible on the storefront with its photos
        pub = c.get("/api/products/saffron-silk-kurta").json()
        assert pub["images"][0] == urls[0] and pub["price"] == 2999

        # reprice + drop a photo -> file deleted from disk
        upd = c.put(f"/api/admin/products/{p['id']}", headers=h,
                    json={**body, "price": 2499, "images": [urls[1]]}).json()
        assert upd["price"] == 2499 and upd["images"] == [urls[1]]
        assert c.get(urls[0]).status_code == 404

        # hide -> gone from shop and checkout
        c.put(f"/api/admin/products/{p['id']}", headers=h, json={**body, "images": [urls[1]], "is_active": False})
        assert c.get("/api/products/saffron-silk-kurta").status_code == 404
        q = c.post("/api/checkout/quote", json={"items": [{"product_id": p["id"], "size": "M", "quantity": 1}]})
        assert q.status_code == 404

        assert c.delete(f"/api/admin/products/{p['id']}", headers=h).json()["archived"] is False
        assert c.get(urls[1]).status_code == 404


def test_offers_manage_and_apply():
    with TestClient(app) as c:
        h = login(c)
        o = c.post("/api/admin/coupons", headers=h, json={
            "code": "diwali25", "kind": "percent", "value": 25, "max_discount": 1000, "min_subtotal": 2000,
            "description": "Diwali: 25% off", "show_in_banner": True}).json()
        assert o["code"] == "DIWALI25" and o["live"]
        assert c.post("/api/admin/coupons", headers=h, json={"code": "DIWALI25", "kind": "flat", "value": 1}).status_code == 409
        assert c.post("/api/admin/coupons", headers=h, json={"code": "TOOBIG", "kind": "percent", "value": 95}).status_code == 422
        assert {"code": "DIWALI25", "description": "Diwali: 25% off"} in c.get("/api/offers").json()

        item = {"items": [{"product_id": 1, "size": "M", "quantity": 1}], "coupon": "DIWALI25"}
        q = c.post("/api/checkout/quote", json=item).json()  # Ivory Linen Shirt ₹2,499 -> 25% = ₹624
        assert (q["coupon"], q["discount"]) == ("DIWALI25", 624)
        small = {"items": [{"product_id": 11, "size": "M", "quantity": 1}], "coupon": "DIWALI25"}  # ₹999 < ₹2,000
        assert c.post("/api/checkout/quote", json=small).json()["discount"] == 0

        # expired offers stop working and leave the banner
        c.put(f"/api/admin/coupons/{o['id']}", headers=h, json={
            "code": "DIWALI25", "kind": "percent", "value": 25, "min_subtotal": 2000,
            "ends_at": "2020-01-01T00:00:00Z", "show_in_banner": True})
        assert c.post("/api/checkout/quote", json=item).json()["coupon"] == ""
        assert all(x["code"] != "DIWALI25" for x in c.get("/api/offers").json())
        c.delete(f"/api/admin/coupons/{o['id']}", headers=h)

        s = c.get("/api/admin/stats", headers=h).json()
        assert s["products"] >= 16 and "revenue" in s
