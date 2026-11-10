import os
import tempfile

# One throwaway DB + media folder for the whole test run, set before the app reads settings.
_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("MEDIA_DIR", os.path.join(_tmp, "media"))
os.environ.setdefault("SHIPROCKET_WEBHOOK_TOKEN", "test-hook-token")
os.environ.setdefault("OTP_RESEND_SECONDS", "0")
for k in ("RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "SMTP_HOST", "WHATSAPP_TOKEN", "SHIPROCKET_EMAIL"):
    os.environ[k] = ""
