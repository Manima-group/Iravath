"""Customer notifications: email (SMTP) + WhatsApp (Meta Cloud API).

Both channels fall back to logging when not configured, so local dev and tests never send anything.
Functions here open their own DB session because they run as FastAPI BackgroundTasks.

WhatsApp templates (create + get them approved in Meta Business Manager, language = WHATSAPP_LANG):
  order_confirmed : {{1}} name, {{2}} order number, {{3}} payment line (e.g. "Paid ₹2,499" / "₹200 paid, ₹2,050 on delivery")
  order_shipped   : {{1}} name, {{2}} order number, {{3}} courier, {{4}} AWB, {{5}} tracking link
  order_delivered : {{1}} name, {{2}} order number
"""
import html
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

import httpx

from ..config import get_settings
from ..db import SessionLocal
from ..models import Customer, NotificationLog, Order, OrderEvent

log = logging.getLogger("iravath.notify")


def inr(n: int) -> str:
    """Indian digit grouping: 123456 -> ₹1,23,456"""
    sign, digits = ("-" if n < 0 else ""), str(abs(int(n)))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        head = ",".join([head[max(i - 2, 0):i] for i in range(len(head), 0, -2)][::-1])
        digits = f"{head},{tail}"
    return f"{sign}₹{digits}"


# ---------------------------------------------------------------- email
def _layout(title: str, body_html: str) -> str:
    s = get_settings()
    return f"""<!doctype html><html><body style="margin:0;background:#f7f1e6;font-family:Arial,Helvetica,sans-serif;color:#1d1a16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1e6;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #e2d6c1">
<tr><td align="center" style="padding:26px 24px 14px;border-bottom:1px solid #e2d6c1">
  <img src="{s.store_url}/img/logo-mark.png" width="64" alt="" style="display:block;margin:0 auto 8px">
  <div style="font-family:Georgia,serif;font-size:26px;letter-spacing:6px">IRAVATH</div>
  <div style="font-size:9px;letter-spacing:4px;color:#8c6b2a;margin-top:4px">A PREMIUM CLOTHING BRAND</div></td></tr>
<tr><td style="padding:26px 28px">
  <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 14px">{html.escape(title)}</h1>{body_html}</td></tr>
<tr><td style="padding:16px 28px;background:#1d1a16;color:#cfc6b6;font-size:12px;text-align:center">
  Iravath · Premium Menswear · Hyderabad<br><a href="{s.store_url}" style="color:#e6c77f">{s.store_url.replace('https://', '')}</a></td></tr>
</table></td></tr></table></body></html>"""


def _button(url: str, label: str) -> str:
    return (f'<p style="margin:22px 0"><a href="{url}" style="background:#b08a3e;color:#fff;text-decoration:none;'
            f'padding:12px 22px;display:inline-block;letter-spacing:1px">{html.escape(label)}</a></p>')


def _items_table(o: Order) -> str:
    rows = "".join(
        f'<tr><td style="padding:6px 0">{html.escape(i.name)} <span style="color:#8b8172">· {html.escape(i.size)} × {i.quantity}</span></td>'
        f'<td align="right">{inr(i.unit_price * i.quantity)}</td></tr>' for i in o.items)
    extra = ""
    if o.discount:
        extra += f'<tr><td style="padding:4px 0;color:#2f6b3f">Discount {html.escape(o.coupon)}</td><td align="right" style="color:#2f6b3f">−{inr(o.discount)}</td></tr>'
    extra += f'<tr><td style="padding:4px 0">Shipping</td><td align="right">{inr(o.shipping) if o.shipping else "Free"}</td></tr>'
    extra += f'<tr><td style="padding:8px 0;border-top:1px solid #e2d6c1"><b>Total</b></td><td align="right" style="border-top:1px solid #e2d6c1"><b>{inr(o.total)}</b></td></tr>'
    if o.payment_method == "cod":
        extra += (f'<tr><td style="padding:4px 0">Paid online</td><td align="right">{inr(o.pay_now)}</td></tr>'
                  f'<tr><td style="padding:4px 0"><b>To pay on delivery</b></td><td align="right"><b>{inr(o.pay_on_delivery)}</b></td></tr>')
    return f'<table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse">{rows}{extra}</table>'


def _address(o: Order) -> str:
    a = o.address or {}
    parts = [a.get("line1"), a.get("line2"), a.get("city"), f'{a.get("state", "")} {a.get("pincode", "")}'.strip()]
    return html.escape(", ".join(p for p in parts if p))


def payment_line(o: Order) -> str:
    return (f"{inr(o.pay_now)} paid, {inr(o.pay_on_delivery)} on delivery" if o.payment_method == "cod"
            else f"Paid {inr(o.total)}")


def render_email(event: str, o: Order) -> tuple[str, str]:
    s = get_settings()
    name = html.escape((o.customer or {}).get("name", "").split(" ")[0] or "there")
    order_url = f"{s.store_url}/order/{o.number}"
    if event == "order_confirmed":
        subj = f"Order {o.number} confirmed"
        body = (f"<p>Hi {name}, thank you for shopping with Iravath. Your order is confirmed and we're getting it ready.</p>"
                f"{_items_table(o)}<p style='font-size:13px;color:#5a5247'>Delivering to: {_address(o)}</p>"
                f"{_button(order_url, 'View your order')}")
        return subj, _layout("Your order is confirmed", body)
    if event == "order_shipped":
        track = _button(o.tracking_url, "Track your parcel") if o.tracking_url else ""
        cod = (f"<p>Please keep <b>{inr(o.pay_on_delivery)}</b> ready to pay on delivery (cash or UPI).</p>"
               if o.payment_method == "cod" else "")
        body = (f"<p>Hi {name}, good news: order <b>{o.number}</b> is on its way.</p>"
                f"<p>Courier: <b>{html.escape(o.courier_name or 'Our delivery partner')}</b><br>AWB: <b>{html.escape(o.awb_code or '-')}</b></p>{cod}{track}")
        return f"Order {o.number} has shipped", _layout("Your order has shipped", body)
    if event == "out_for_delivery":
        cod = f"<p>Amount to pay: <b>{inr(o.pay_on_delivery)}</b></p>" if o.payment_method == "cod" else ""
        body = f"<p>Hi {name}, order <b>{o.number}</b> is out for delivery today.</p>{cod}{_button(order_url, 'View order')}"
        return f"Order {o.number} is out for delivery", _layout("Arriving today", body)
    if event == "order_delivered":
        body = (f"<p>Hi {name}, order <b>{o.number}</b> has been delivered. We hope you love it.</p>"
                f"<p>Need a different size? Free exchanges within 7 days of delivery.</p>{_button(order_url, 'View order')}")
        return f"Order {o.number} delivered", _layout("Delivered", body)
    if event == "order_cancelled":
        refund = ("<p>Any amount paid online will be refunded to your original payment method within 5–7 working days.</p>"
                  if o.pay_now else "")
        body = f"<p>Hi {name}, order <b>{o.number}</b> has been cancelled.</p>{refund}<p>Questions? Just reply to this email.</p>"
        return f"Order {o.number} cancelled", _layout("Order cancelled", body)
    if event == "admin_new_order":
        c = o.customer or {}
        body = (f"<p><b>{html.escape(c.get('name', ''))}</b> · {html.escape(c.get('email', ''))} · {html.escape(c.get('phone', ''))}</p>"
                f"<p>{'COD' if o.payment_method == 'cod' else 'Prepaid'} · {payment_line(o)}</p>{_items_table(o)}"
                f"<p style='font-size:13px'>{_address(o)}</p>{_button(s.api_url + '/admin.html#orders', 'Open in admin')}")
        return f"New order {o.number} · {inr(o.total)}", _layout(f"New order {o.number}", body)
    raise ValueError(event)


def render_otp_email(code: str) -> tuple[str, str]:
    s = get_settings()
    body = (f"<p>Use this code to sign in to your Iravath account:</p>"
            f'<p style="font-family:Georgia,serif;font-size:36px;letter-spacing:10px;margin:18px 0;color:#8c6b2a">{code}</p>'
            f"<p style='font-size:13px;color:#5a5247'>It expires in {s.otp_ttl_minutes} minutes. If you didn't request it, you can ignore this email.</p>")
    return f"{code} is your Iravath sign-in code", _layout("Your sign-in code", body)


def send_email(to: str, subject: str, html_body: str) -> tuple[str, str]:
    """Returns (status, error). status: sent | logged | failed"""
    s = get_settings()
    if not s.smtp_host:
        log.warning("[email:dev] to=%s subject=%s", to, subject)
        return "logged", ""
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.mail_from, to, subject
    msg["Message-ID"] = make_msgid(domain=s.mail_from.split("@")[-1].strip("> "))
    msg.set_content("Please view this email in an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")
    try:
        if s.smtp_use_ssl:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ssl.create_default_context(), timeout=20) as smtp:
                smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
        return "sent", ""
    except Exception as e:  # never let email failures break an order
        log.exception("email to %s failed", to)
        return "failed", str(e)[:300]


# ---------------------------------------------------------------- WhatsApp
WA_EVENTS = {"order_confirmed", "order_shipped", "order_delivered"}


def wa_params(event: str, o: Order) -> list[str]:
    name = (o.customer or {}).get("name", "").split(" ")[0] or "there"
    if event == "order_confirmed":
        return [name, o.number, payment_line(o)]
    if event == "order_shipped":
        return [name, o.number, o.courier_name or "our courier", o.awb_code or "-", o.tracking_url or get_settings().store_url]
    return [name, o.number]


def send_whatsapp(phone: str, template: str, params: list[str]) -> tuple[str, str]:
    s = get_settings()
    to = "91" + phone[-10:]
    if not (s.whatsapp_token and s.whatsapp_phone_number_id):
        log.warning("[whatsapp:dev] to=%s template=%s params=%s", to, template, params)
        return "logged", ""
    payload = {
        "messaging_product": "whatsapp", "to": to, "type": "template",
        "template": {"name": template, "language": {"code": s.whatsapp_lang},
                     "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]},
    }
    try:
        r = httpx.post(f"https://graph.facebook.com/v21.0/{s.whatsapp_phone_number_id}/messages",
                       headers={"Authorization": f"Bearer {s.whatsapp_token}"}, json=payload, timeout=15)
        if r.status_code >= 300:
            return "failed", r.text[:300]
        return "sent", ""
    except Exception as e:
        log.exception("whatsapp to %s failed", to)
        return "failed", str(e)[:300]


# ---------------------------------------------------------------- dispatcher
def notify_order(order_number: str, event: str) -> None:
    """Send `event` for an order on every channel. Safe to call from BackgroundTasks."""
    s = get_settings()
    db = SessionLocal()
    try:
        o = db.query(Order).filter(Order.number == order_number).first()
        if not o:
            return
        c = o.customer or {}
        results = []
        if c.get("email"):
            st, err = send_email(c["email"], *render_email(event, o))
            db.add(NotificationLog(order_number=o.number, channel="email", event=event, to=c["email"], status=st, error=err))
            results.append(f"email {st}")
        if event == "order_confirmed" and s.admin_notify_email:
            st, err = send_email(s.admin_notify_email, *render_email("admin_new_order", o))
            db.add(NotificationLog(order_number=o.number, channel="email", event="admin_new_order",
                                   to=s.admin_notify_email, status=st, error=err))
        account = db.get(Customer, o.customer_id) if o.customer_id else None
        wa_ok = account.whatsapp_opt_in if account else True
        if event in WA_EVENTS and c.get("phone") and wa_ok:
            tpl = {"order_confirmed": s.wa_tpl_order_confirmed, "order_shipped": s.wa_tpl_order_shipped,
                   "order_delivered": s.wa_tpl_order_delivered}[event]
            st, err = send_whatsapp(c["phone"], tpl, wa_params(event, o))
            db.add(NotificationLog(order_number=o.number, channel="whatsapp", event=event, to=c["phone"], status=st, error=err))
            results.append(f"WhatsApp {st}")
        if results:
            db.add(OrderEvent(order_id=o.id, kind="notify", message=f"{event.replace('_', ' ').capitalize()}: {', '.join(results)}"))
        db.commit()
    finally:
        db.close()
