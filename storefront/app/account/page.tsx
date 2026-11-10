"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import { useStore } from "@/components/StoreProvider";
import { api } from "@/lib/client-api";
import { FULFILMENT_LABEL, inr } from "@/lib/format";
import type { Customer, OrderSummary } from "@/lib/types";

type LoginOut = { token: string; customer: Customer; merged: { wishlist_merged: number; orders_linked: number }; is_new: boolean };

function SignIn() {
  const { completeLogin, toast } = useStore();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const send = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/auth/otp/request", { method: "POST", body: { email } });
      setMsg(r.message); setStep("code"); setCode(""); setWait(30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setErr(""); setBusy(true);
    try {
      const r = await api<LoginOut>("/api/auth/otp/verify", { method: "POST", body: { email, code: value } });
      await completeLogin(r);
      const bits = [];
      if (r.merged.wishlist_merged) bits.push(`${r.merged.wishlist_merged} wishlist item${r.merged.wishlist_merged > 1 ? "s" : ""} saved to your account`);
      if (r.merged.orders_linked) bits.push(`${r.merged.orders_linked} past order${r.merged.orders_linked > 1 ? "s" : ""} linked`);
      toast(r.is_new ? "Welcome to Iravath!" + (bits.length ? ` ${bits.join(", ")}.` : "") : bits.length ? `Signed in · ${bits.join(", ")}` : "Signed in");
      if (next?.startsWith("/")) router.push(next);
    } catch (e) { setErr((e as Error).message); setCode(""); codeRef.current?.focus(); } finally { setBusy(false); }
  };

  return (
    <div className="auth-card panel">
      <img src="/img/logo-mark.png" alt="" width={70} className="auth-mark" />
      <h1>{step === "email" ? "Sign in or create an account" : "Check your email"}</h1>
      {step === "email" ? (
        <form onSubmit={(e) => { e.preventDefault(); send(); }} noValidate>
          <p className="small">We'll email you a 6-digit code. No password needed. Your wishlist on this device is saved to your account.</p>
          <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <p className="err">{err}</p>
          <button className="btn gold block" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} noValidate>
          <p className="small">{msg}. It expires in 10 minutes.</p>
          <label className="field">6-digit code
            <input ref={codeRef} className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} aria-describedby="otp-err" />
          </label>
          <p className="err" id="otp-err">{err}</p>
          <button className="btn gold block" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</button>
          <p className="small" style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button type="button" className="link" onClick={() => { setStep("email"); setErr(""); }}>Use a different email</button>
            <button type="button" className="link" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend in ${wait}s` : "Resend code"}</button>
          </p>
        </form>
      )}
    </div>
  );
}

function Profile() {
  const { customer, setCustomer, logout, toast } = useStore();
  const c = customer!;
  const [f, setF] = useState({ name: c.name, phone: c.phone, line1: c.address?.line1 || "", line2: c.address?.line2 || "", city: c.address?.city || "", state: c.address?.state || "", pincode: c.address?.pincode || "", wa: c.whatsapp_opt_in });
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<OrderSummary[]>("/api/account/orders").then(setOrders).catch(() => setOrders([])); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const hasAddr = f.line1 || f.city || f.pincode;
      const updated = await api<Customer>("/api/account/me", { method: "PUT", body: {
        name: f.name, phone: f.phone, whatsapp_opt_in: f.wa,
        address: hasAddr ? { line1: f.line1, line2: f.line2, city: f.city, state: f.state, pincode: f.pincode } : null } });
      setCustomer(updated); toast("Details saved");
    } catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };
  const inp = (k: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, full = false) => (
    <label className={`field ${full ? "full" : ""}`}>{label}<input value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>
  );

  return (
    <div className="account">
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "end", flexWrap: "wrap", gap: 12 }}>
        <div><div className="eyebrow">My account</div><h1>Hello{c.name ? `, ${c.name.split(" ")[0]}` : ""}</h1><p className="small">{c.email}</p></div>
        <button className="btn ghost" onClick={logout}>Sign out</button>
      </div>
      <div className="account-grid">
        <section className="panel">
          <h3>My orders</h3>
          {!orders ? <BrandLoader /> : orders.length === 0 ? <p className="small">No orders yet. <Link className="link" href="/shop">Start shopping</Link></p> : (
            <div className="order-list">{orders.map((o) => (
              <Link key={o.number} href={`/order/${o.number}`} className="order-card">
                <div><b>{o.number}</b><span className="small">{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {o.items.reduce((s, i) => s + i.quantity, 0)} item(s)</span>
                  <span className="small">{o.items.map((i) => i.name).join(", ")}</span></div>
                <div style={{ textAlign: "right" }}><b>{inr(o.total)}</b><span className={`status-pill s-${o.fulfilment_status}`}>{FULFILMENT_LABEL[o.fulfilment_status] || o.fulfilment_status}</span></div>
              </Link>))}</div>
          )}
        </section>
        <section className="panel">
          <h3>Saved details</h3>
          <p className="small">Used to fill in checkout for you.</p>
          <div className="fields">
            {inp("name", "Full name", { autoComplete: "name" }, true)}
            {inp("phone", "Mobile number", { inputMode: "numeric", autoComplete: "tel" }, true)}
            {inp("line1", "House / flat, street", { autoComplete: "address-line1" }, true)}
            {inp("line2", "Area, landmark", { autoComplete: "address-line2" }, true)}
            {inp("city", "City", { autoComplete: "address-level2" })}
            {inp("state", "State", { autoComplete: "address-level1" })}
            {inp("pincode", "PIN code", { inputMode: "numeric", maxLength: 6 })}
          </div>
          <label className="check-row"><input type="checkbox" checked={f.wa} onChange={(e) => setF({ ...f, wa: e.target.checked })} /> Send order updates on WhatsApp</label>
          <button className="btn gold" onClick={save} disabled={saving} style={{ marginTop: 14 }}>{saving ? "Saving…" : "Save details"}</button>
        </section>
      </div>
    </div>
  );
}

function AccountView() {
  const { ready, customer } = useStore();
  if (!ready) return <div className="page-loader"><BrandLoader size="lg" /></div>;
  return customer ? <Profile key={customer.id} /> : <SignIn />;
}

export default function AccountPage() {
  return <div className="wrap"><Suspense fallback={<div className="page-loader"><BrandLoader size="lg" /></div>}><AccountView /></Suspense></div>;
}
