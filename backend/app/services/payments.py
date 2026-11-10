"""Razorpay gateway wrapper with a drop-in MOCK mode for local development.

Live/test mode: set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (+ RAZORPAY_WEBHOOK_SECRET) in .env.
Mock mode: keys empty -> orders get `order_mock_*` ids and signatures are HMAC'd with
MOCK_PAYMENT_SECRET, so the exact same verify code path is exercised.
"""
import hashlib
import hmac
import secrets

from ..config import get_settings


def _hmac(secret: str, message: str | bytes) -> str:
    if isinstance(message, str):
        message = message.encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def _signing_secret() -> str:
    s = get_settings()
    return s.mock_payment_secret if s.payments_mock else s.razorpay_key_secret


def create_gateway_order(amount_paise: int, receipt: str, notes: dict) -> str:
    s = get_settings()
    if s.payments_mock:
        return f"order_mock_{secrets.token_hex(7)}"
    import razorpay  # imported lazily so mock mode needs no SDK

    client = razorpay.Client(auth=(s.razorpay_key_id, s.razorpay_key_secret))
    order = client.order.create({
        "amount": amount_paise,
        "currency": s.currency,
        "receipt": receipt,
        "notes": notes,
        "payment_capture": 1,
    })
    return order["id"]


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Razorpay standard checkout: HMAC_SHA256(order_id + '|' + payment_id, key_secret)."""
    expected = _hmac(_signing_secret(), f"{order_id}|{payment_id}")
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    s = get_settings()
    secret = s.razorpay_webhook_secret or (s.mock_payment_secret if s.payments_mock else "")
    if not secret or not signature:
        return False
    return hmac.compare_digest(_hmac(secret, body), signature)


def mock_sign(order_id: str) -> dict:
    """Only used in mock mode: simulate what Razorpay Checkout hands back to the browser."""
    payment_id = f"pay_mock_{secrets.token_hex(7)}"
    return {
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "razorpay_signature": _hmac(get_settings().mock_payment_secret, f"{order_id}|{payment_id}"),
    }
