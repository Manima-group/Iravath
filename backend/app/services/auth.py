
"""Signed-token authentication for Iravath's single admin account."""

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..config import get_settings


# Swagger UI will recognize this as Bearer authentication.
bearer_scheme = HTTPBearer(auto_error=False)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: str) -> str:
    return _b64(
        hmac.new(
            get_settings().admin_secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).digest()
    )


def check_credentials(email: str, password: str) -> bool:
    s = get_settings()

    ok_email = hmac.compare_digest(
        email.strip().lower(),
        s.admin_email.lower()
    )

    ok_pass = hmac.compare_digest(
        password.encode(),
        s.admin_password.encode()
    )

    return ok_email and ok_pass


def create_token(email: str) -> tuple[str, datetime]:
    exp = datetime.now(timezone.utc) + timedelta(
        hours=get_settings().admin_token_hours
    )

    payload = _b64(
        json.dumps({
            "sub": email,
            "exp": int(exp.timestamp())
        }).encode()
    )

    return f"{payload}.{_sign(payload)}", exp


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload, sig = token.split(".")

        if not hmac.compare_digest(sig, _sign(payload)):
            raise ValueError("Invalid token signature")

        data = json.loads(_unb64(payload))

        if data["exp"] < datetime.now(timezone.utc).timestamp():
            raise HTTPException(
                status_code=401,
                detail="Session expired, please log in again",
            )

        return data["sub"]

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
