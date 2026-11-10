"""Product photo processing: validate, strip EXIF, auto-rotate, resize, save as WebP."""
import io
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import get_settings

MAX_SIDE = 1600
ALLOWED = {"JPEG", "PNG", "WEBP", "MPO"}


async def save_product_image(upload: UploadFile) -> str:
    s = get_settings()
    data = await upload.read(s.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Image is larger than {s.max_upload_mb} MB")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(415, "Upload a JPG, PNG or WebP image")
    if fmt not in ALLOWED:
        raise HTTPException(415, "Upload a JPG, PNG or WebP image")
    img = ImageOps.exif_transpose(img)  # phone photos come rotated via EXIF
    img = img.convert("RGBA") if img.mode in ("P", "LA", "RGBA") else img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    folder: Path = s.media_dir / "products"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(8)}.webp"
    img.save(folder / name, "WEBP", quality=84, method=5)  # saving re-encodes, dropping EXIF/GPS
    return f"/media/products/{name}"


def delete_media_file(url: str) -> None:
    s = get_settings()
    if not url.startswith("/media/products/"):
        return
    path = (s.media_dir / url.removeprefix("/media/")).resolve()
    if path.is_relative_to(s.media_dir.resolve()) and path.exists():
        path.unlink()
