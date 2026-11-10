"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import { useStore } from "@/components/StoreProvider";
import { api } from "@/lib/client-api";
import { FULFILMENT_LABEL, inr } from "@/lib/format";
import type { Order } from "@/lib/types";

const STEPS = ["unfulfilled", "processing", "shipped", "out_for_delivery", "delivered"];

function OrderView() {
  const { number } = useParams<{ number: string }>();
  const placed = useSearchParams().get("placed") === "1";
  const { ready, customer } = useStore();
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!ready) return;
    api<Order>(`/api/orders/${encodeURIComponent(number)}`).then(setO).catch((e: Error) => setErr(e.message));
  }, [ready, number, customer?.id]);

  if (err) return (
    <div className="wrap empty" style={{ padding: "80px 20px" }}><h2>We couldn't find that order</h2>
      <p>Orders are visible on the device that placed them, or after signing in with the email used at checkout.</p>
      <Link className="btn" href={`/account?next=/order/${number}`}>Sign in</Link></div>
  );
  if (!o) return <div className="wrap page-loader"><BrandLoader size="lg" /></div>;

  const paid = o.status === "paid" || o.status === "cod_confirmed";
  const closed = o.fulfilment_status === "cancelled" || o.fulfilment_status === "rto";
  const at = STEPS.indexOf(o.fulfilment_status);
  return (
    <div className="wrap success">
      {placed && paid ? (<><div className="tick">✓</div><h1>Thank you, {o.customer.name.split(" ")[0]}!</h1>
        <p>Order <b>{o.number}</b> is confirmed. A confirmation is on its way to {o.customer.email}{o.customer.phone ? " and on WhatsApp" : ""}.</p></>)
        : (<><div className="eyebrow">Order {o.number}</div><h1>{paid ? FULFILMENT_LABEL[o.fulfilment_status] || "Confirmed" : "Payment pending"}</h1></>)}

      {paid && !closed && (
        <ol className="track" aria-label="Order progress">
          {STEPS.map((s, i) => <li key={s} className={i <= at ? "done" : ""}><span />{FULFILMENT_LABEL[s]}</li>)}
        </ol>
      )}
      {o.awb_code && (
        <p>{o.courier_name || "Courier"} · AWB <b>{o.awb_code}</b>{o.tracking_url && <> · <a className="link" href={o.tracking_url} target="_blank" rel="noopener">Track parcel ↗</a></>}</p>
      )}

      <div className="panel">
        <h3>Order {o.number}</h3>
        {o.items.map((i, k) => <div className="row" key={k}><span>{i.name} · {i.size} × {i.quantity}</span><span>{inr(i.unit_price * i.quantity)}</span></div>)}
        {o.discount > 0 && <div className="row" style={{ color: "var(--ok)" }}><span>Discount {o.coupon}</span><span>−{inr(o.discount)}</span></div>}
        <div className="row"><span>Shipping</span><span>{o.shipping ? inr(o.shipping) : "Free"}</span></div>
        <div className="row total"><span>Total</span><span>{inr(o.total)}</span></div>
        <div className="row"><span>Paid online</span><span>{paid ? inr(o.pay_now) : inr(0)}</span></div>
        {o.payment_method === "cod" && <div className="row"><b>Due on delivery</b><b>{inr(o.pay_on_delivery)}</b></div>}
        <p className="small" style={{ marginTop: 14 }}>Ship to: {o.address.line1}{o.address.line2 ? `, ${o.address.line2}` : ""}, {o.address.city}, {o.address.state} {o.address.pincode}</p>
        {o.timeline?.length > 0 && (
          <div className="timeline-pub">{o.timeline.slice().reverse().map((t, k) => (
            <div key={k}><b>{t.message}</b> <span className="small">{new Date(t.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span></div>
          ))}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
        <Link className="btn" href="/shop">Continue shopping</Link>
        {customer ? <Link className="btn ghost" href="/account">My orders</Link> : <Link className="btn ghost" href={`/account?next=/order/${o.number}`}>Create an account to track orders</Link>}
      </div>
    </div>
  );
}

export default function OrderPage() {
  return <Suspense fallback={<div className="wrap page-loader"><BrandLoader size="lg" /></div>}><OrderView /></Suspense>;
}
