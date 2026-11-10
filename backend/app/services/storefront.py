"""Tell the Next.js storefront to refresh cached pages right after admin edits (otherwise ISR updates within 60s)."""
import logging

import httpx

from ..config import get_settings

log = logging.getLogger("iravath.storefront")


def revalidate(paths: list[str]) -> None:
    s = get_settings()
    if not s.storefront_revalidate_secret:
        return
    try:
        httpx.post(f"{s.store_url.rstrip('/')}/api/revalidate", json={"paths": paths},
                   headers={"x-revalidate-secret": s.storefront_revalidate_secret}, timeout=10)
    except Exception as e:  # storefront down: pages still refresh on their 60s timer
        log.warning("storefront revalidate failed: %s", e)
