"""Shiprocket API client (https://apidocs.shiprocket.in). Mock mode when SHIPROCKET_EMAIL is empty.

Use an API user (Shiprocket panel -> Settings -> API -> Create API User), not your main login.
"""
import logging
import secrets
import threading
import time

import httpx

from ..config import get_settings
from ..models import Order

log = logging.getLogger("iravath.shiprocket")
BASE = "https://apiv2.shiprocket.in/v1/external"
_token: dict = {"value": "", "exp": 0.0}
_lock = threading.Lock()


class ShiprocketError(Exception):
    pass


def is_mock() -> bool:
    s = get_settings()
    return not (s.shiprocket_email and s.shiprocket_password)


def _auth() -> str:
    """Tokens are valid ~10 days; refresh after 9."""
    with _lock:
        if _token["value"] and _token["exp"] > time.time():
            return _token["value"]
        s = get_settings()
        r = httpx.post(f"{BASE}/auth/login", json={"email": s.shiprocket_email, "password": s.shiprocket_password}, timeout=20)
        if r.status_code != 200 or "token" not in r.json():
            raise ShiprocketError(f"Shiprocket login failed ({r.status_code}): {r.text[:200]}")
        _token.update(value=r.json()["token"], exp=time.time() + 9 * 86400)
        return _token["value"]


def _call(method: str, path: str, json: dict) -> dict:
    r = httpx.request(method, BASE + path, json=json, headers={"Authorization": f"Bearer {_auth()}"}, timeout=30)
    if r.status_code == 401:  # token revoked -> retry once with a fresh login
        _token["value"] = ""
        r = httpx.request(method, BASE + path, json=json, headers={"Authorization": f"Bearer {_auth()}"}, timeout=30)
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"raw": r.text}
    if r.status_code >= 300:
        raise ShiprocketError(f"{path} failed ({r.status_code}): {str(data)[:250]}")
    return data


def build_order_payload(o: Order) -> dict:
    """Partial COD: the courier must collect only pay_on_delivery. Shiprocket collects
    sub_total + shipping - total_discount, so the online advance is passed as part of total_discount."""
    s = get_settings()
    c, a = o.customer or {}, o.address or {}
    first, _, last = (c.get("name") or "Customer").partition(" ")
    sub_total = sum(i.unit_price * i.quantity for i in o.items)
    advance = o.pay_now if o.payment_method == "cod" else 0
    return {
        "order_id": o.number,
        "order_date": (o.paid_at or o.created_at).strftime("%Y-%m-%d %H:%M"),
        "pickup_location": s.shiprocket_pickup_location,
        "billing_customer_name": first, "billing_last_name": last or ".",
        "billing_address": a.get("line1", ""), "billing_address_2": a.get("line2", ""),
        "billing_city": a.get("city", ""), "billing_pincode": a.get("pincode", ""), "billing_state": a.get("state", ""),
        "billing_country": "India", "billing_email": c.get("email", ""), "billing_phone": c.get("phone", ""),
        "shipping_is_billing": True,
        "order_items": [{"name": i.name, "sku": f"IRV-{i.product_id}-{i.size}", "units": i.quantity,
                         "selling_price": i.unit_price, "discount": 0, "tax": 0} for i in o.items],
        "payment_method": "COD" if o.payment_method == "cod" else "Prepaid",
        "shipping_charges": o.shipping, "giftwrap_charges": 0, "transaction_charges": 0,
        "total_discount": o.discount + advance,
        "sub_total": sub_total,
        "length": s.package_length_cm, "breadth": s.package_breadth_cm, "height": s.package_height_cm,
        "weight": round(max(0.1, s.package_weight_kg * sum(i.quantity for i in o.items)), 2),  # kg per piece x pieces
    }


def create_order(o: Order) -> dict:
    """Returns {order_id, shipment_id}."""
    if is_mock():
        return {"order_id": f"MOCK{secrets.randbelow(10**7):07d}", "shipment_id": f"MOCK{secrets.randbelow(10**7):07d}"}
    data = _call("POST", "/orders/create/adhoc", build_order_payload(o))
    if not data.get("shipment_id"):
        raise ShiprocketError(f"No shipment created: {str(data)[:250]}")
    return {"order_id": str(data["order_id"]), "shipment_id": str(data["shipment_id"])}


def assign_awb(shipment_id: str) -> dict:
    """Auto-selects the recommended courier. Returns {awb_code, courier_name, tracking_url}."""
    if is_mock():
        awb = f"MOCKAWB{secrets.randbelow(10**9):09d}"
        return {"awb_code": awb, "courier_name": "Mock Express", "tracking_url": f"https://shiprocket.co/tracking/{awb}"}
    data = _call("POST", "/courier/assign/awb", {"shipment_id": int(shipment_id)})
    resp = (data.get("response") or {}).get("data") or {}
    if data.get("awb_assign_status") != 1 or not resp.get("awb_code"):
        raise ShiprocketError(f"AWB not assigned: {str(data)[:250]}")
    return {"awb_code": resp["awb_code"], "courier_name": resp.get("courier_name", ""),
            "tracking_url": f"https://shiprocket.co/tracking/{resp['awb_code']}"}


def cancel_order(shiprocket_order_id: str) -> None:
    if is_mock() or not shiprocket_order_id:
        return
    _call("POST", "/orders/cancel", {"ids": [int(shiprocket_order_id)]})


# Shiprocket tracking webhook `current_status` -> our fulfilment status
WEBHOOK_STATUS = {
    "PICKED UP": "shipped", "PICKUP COMPLETE": "shipped", "SHIPPED": "shipped", "IN TRANSIT": "shipped",
    "REACHED AT DESTINATION HUB": "shipped", "OUT FOR DELIVERY": "out_for_delivery", "DELIVERED": "delivered",
    "RTO INITIATED": "rto", "RTO IN TRANSIT": "rto", "RTO DELIVERED": "rto",
    "CANCELED": "cancelled", "CANCELLED": "cancelled",
}
