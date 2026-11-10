"""Customer session tokens. Signed with CUSTOMER_SECRET (never the admin secret), so a customer
token can never pass the admin check and vice versa."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Customer

customer_bearer = HTTPBearer(auto_error=False, scheme_name="CustomerBearer")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: str) -> str:
    key = get_settings().customer_secret.encode()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())


def create_customer_token(customer_id: int) -> tuple[str, datetime]:
    exp = datetime.now(timezone.utc) + timedelta(days=get_settings().customer_token_days)
    payload = _b64(json.dumps({"cid": customer_id, "typ": "customer", "exp": int(exp.timestamp())}).encode())
    return f"{payload}.{_sign(payload)}", exp


def _decode(token: str) -> int | None:
    try:
        payload, sig = token.split(".")
        if not hmac.compare_digest(sig, _sign(payload)):
            return None
        data = json.loads(_unb64(payload))
        if data.get("typ") != "customer" or data["exp"] < datetime.now(timezone.utc).timestamp():
            return None
        return int(data["cid"])
    except Exception:
        return None


def optional_customer(creds: HTTPAuthorizationCredentials | None = Depends(customer_bearer),
                      db: Session = Depends(get_db)) -> Customer | None:
    if not creds:
        return None
    cid = _decode(creds.credentials)
    return db.get(Customer, cid) if cid else None


def require_customer(customer: Customer | None = Depends(optional_customer)) -> Customer:
    if not customer:
        raise HTTPException(401, "Please log in", headers={"WWW-Authenticate": "Bearer"})
    return customer
