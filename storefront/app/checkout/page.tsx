"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import ProductImage from "@/components/ProductImage";
import { useStore } from "@/components/StoreProvider";
import { api } from "@/lib/client-api";
import { inr } from "@/lib/format";
import type { Quote } from "@/lib/types";

type CreateOrderOut = { order_number: string; razorpay_order_id: string; key_id: string; amount_paise: number; currency: string; mock: boolean; quote: Quote; prefill: Record<string, string> };
type PayResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type Fields = { name: string; email: string; phone: string; line1: string; line2: string; city: string; state: string; pincode: string };
const EMPTY: Fields = { name: "", email: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" };

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: { error?: { description?: string } }) => void) => void } } }

function validate(v: Fields) {
  const e: Partial<Record<keyof Fields, string>> = {};
  if (v.name.trim().length < 2) e.name = "Enter your name";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = "Enter a valid email";
  if (!/^[6-9]\d{9}$/.test(v.phone.replace(/\D/g, "").slice(-10))) e.phone = "Enter a valid 10-digit mobile";
  if (v.line1.trim().length < 3) e.line1 = "Enter your address";
  if (v.city.trim().length < 2) e.city = "Enter city";
  if (v.state.trim().length < 2) e.state = "Enter state";
  if (!/^[1-9]\d{5}$/.test(v.pincode.trim())) e.pincode = "6-digit PIN code";
  return e;
}

export default function CheckoutPage() {
  const { ready, cart, clearCart, health, customer, toast, setCartOpen } = useStore();
  const router = useRouter();
  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [pm, setPm] = useState<"online" | "cod">("online");
  const [coupon, setCoupon] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [busy, setBusy] = useState("");
  const [mock, setMock] = useState<{ order: CreateOrderOut; resolve: (r: PayResult) => void; reject: (e: Error) => void } | null>(null);
  const filled = useRef(false);

  // prefill: saved account details, else last checkout on this device
  useEffect(() => {
    if (!ready || filled.current) return;
    filled.current = true;
    let saved: Partial<Fields> = {};
    try { saved = JSON.parse(localStorage.getItem("irv_checkout") || "{}"); } catch { /* ignore */ }
    const a = customer?.address || {};
    setF({ ...EMPTY, ...saved, ...(customer ? { email: customer.email, name: customer.name || saved.name || "", phone: customer.phone || saved.phone || "",
      line1: a.line1 || saved.line1 || "", line2: a.line2 || saved.line2 || "", city: a.city || saved.city || "", state: a.state || saved.state || "", pincode: a.pincode || saved.pincode || "" } : {}) });
  }, [ready, customer]);

  const lines = useCallback(() => cart.map(({ product_id, size, quantity }) => ({ product_id, size, quantity })), [cart]);

  useEffect(() => {
    if (!ready || !cart.length) return;
    let live = true;
    api<Quote>("/api/checkout/quote", { method: "POST", body: { items: lines(), coupon, payment_method: pm } })
      .then((q) => { if (live) { setQuote(q); setQuoteErr(""); } })
      .catch((e: Error) => { if (!live) return; if (pm === "cod") { setPm("online"); toast(e.message); } else setQuoteErr(e.message); });
    return () => { live = false; };
  }, [ready, cart, coupon, pm, lines, toast]);

  if (!ready) return <div className="wrap page-loader"><BrandLoader size="lg" /></div>;
  if (!cart.length) return <div className="wrap empty" style={{ padding: "80px 20px" }}><h2>Your bag is empty</h2><Link className="btn" href="/shop">Continue shopping</Link></div>;

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const field = (k: keyof Fields, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, full = false) => (
    <label className={`field ${full ? "full" : ""}`}>{label}
      <input id={k} value={f[k]} onChange={set(k)} className={errors[k] ? "invalid" : ""} {...props} />
      <span className="err">{errors[k] || ""}</span></label>
  );

  const loadRazorpay = () => new Promise<void>((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => res(); s.onerror = () => rej(new Error("Could not load Razorpay"));
    document.head.appendChild(s);
  });
  const payWithRazorpay = async (o: CreateOrderOut) => {
    await loadRazorpay();
    return new Promise<PayResult>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: o.key_id, amount: o.amount_paise, currency: o.currency, order_id: o.razorpay_order_id, name: "Iravath",
        description: o.quote.payment_method === "cod" ? `COD advance · ${o.order_number}` : `Order ${o.order_number}`,
        image: `${location.origin}/img/icon-512.png`, prefill: o.prefill, notes: { order_number: o.order_number }, theme: { color: "#b08a3e" },
        handler: (r: PayResult) => resolve(r), modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.on("payment.failed", (r) => reject(new Error(r.error?.description || "Payment failed")));
      rzp.open();
    });
  };

  const placeOrder = async () => {
    const e = validate(f);
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(first)?.focus(); toast("Please check the highlighted fields"); return; }
    try { localStorage.setItem("irv_checkout", JSON.stringify(f)); } catch { /* ignore */ }
    try {
      setBusy("Creating your order…");
      const order = await api<CreateOrderOut>("/api/checkout/orders", { method: "POST", body: {
        items: lines(), coupon, payment_method: pm,
        customer: { name: f.name.trim(), email: f.email.trim(), phone: f.phone },
        address: { line1: f.line1.trim(), line2: f.line2.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() },
      } });
      setBusy("");
      const result = order.mock
        ? await new Promise<PayResult>((resolve, reject) => setMock({ order, resolve, reject }))
        : await payWithRazorpay(order);
      setBusy("Confirming your payment…");
      await api("/api/checkout/verify", { method: "POST", body: result });
      clearCart();
      router.push(`/order/${order.order_number}?placed=1`);
    } catch (err) {
      setBusy(""); toast((err as Error).message || "Payment was not completed");
    }
  };

  return (
    <div className="wrap">
      <div className="page-head"><nav className="crumbs"><Link href="/">Home</Link> / Checkout</nav><h1>Checkout</h1></div>
      {!customer && <p className="notice">Have an account? <Link className="link" href="/account?next=/checkout">Sign in</Link> for saved details and order tracking. Or continue as a guest.</p>}
      <div className="checkout">
        <form onSubmit={(e) => { e.preventDefault(); placeOrder(); }} noValidate>
          <div className="panel"><h3>Contact</h3><div className="fields">
            {field("name", "Full name", { autoComplete: "name" }, true)}
            {field("email", "Email", { type: "email", autoComplete: "email", readOnly: !!customer, title: customer ? "Signed in as this email" : undefined })}
            {field("phone", "Mobile number (for delivery + WhatsApp updates)", { type: "tel", inputMode: "numeric", autoComplete: "tel", placeholder: "10-digit mobile" })}
          </div></div>
          <div className="panel"><h3>Delivery address</h3><div className="fields">
            {field("line1", "House / flat, street", { autoComplete: "address-line1" }, true)}
            {field("line2", "Area, landmark (optional)", { autoComplete: "address-line2" }, true)}
            {field("city", "City", { autoComplete: "address-level2" })}
            {field("state", "State", { autoComplete: "address-level1" })}
            {field("pincode", "PIN code", { inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" })}
          </div></div>
          <div className="panel"><h3>Payment</h3>
            <label className="pay-opt"><input type="radio" name="pm" checked={pm === "online"} onChange={() => setPm("online")} />
              <div><b>Pay online</b><span className="small">UPI, cards, net banking, wallets via Razorpay</span></div></label>
            <label className={`pay-opt ${quote && !quote.cod_available ? "disabled" : ""}`}><input type="radio" name="pm" checked={pm === "cod"} onChange={() => setPm("cod")} />
              <div><b>Cash on Delivery</b><span className="small">Pay {inr(health.cod_advance)} online now to confirm, balance in cash/UPI on delivery</span></div></label>
            {health.payments === "mock" && <p className="small">⚠︎ Test mode: payments are simulated. Add Razorpay keys on the server to go live.</p>}
          </div>
        </form>
        <aside className="panel summary">
          <h3>Order summary</h3>
          {quoteErr ? <><p className="coupon-msg bad">{quoteErr}</p><button className="link" onClick={() => setCartOpen(true)}>Edit bag</button></> : !quote ? <BrandLoader label="Calculating totals" /> : (
            <>
              {quote.lines.map((l) => { const it = cart.find((c) => c.product_id === l.product_id && c.size === l.size); return (
                <div className="line" style={{ gridTemplateColumns: "56px 1fr auto" }} key={`${l.product_id}-${l.size}`}>
                  <div className="thumb"><ProductImage src={it?.snapshot.image} alt={l.name} sizes="56px" /></div>
                  <div><div className="nm" style={{ fontSize: 16 }}>{l.name}</div><div className="meta">Size {l.size} · Qty {l.quantity}</div></div><b>{inr(l.line_total)}</b>
                </div>); })}
              <div className="coupon">
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Coupon code" aria-label="Coupon code"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setCoupon(couponInput.trim()); } }} />
                <button className="btn ghost" type="button" onClick={() => { if (quote.coupon) { setCoupon(""); setCouponInput(""); } else setCoupon(couponInput.trim()); }}>{quote.coupon ? "Remove" : "Apply"}</button>
              </div>
              <div className={`coupon-msg ${quote.coupon ? "ok" : quote.coupon_message ? "bad" : ""}`}>{quote.coupon_message || "Have a code? Try IRAVATH10"}</div>
              <div style={{ marginTop: 12 }}>
                <div className="row"><span>Subtotal</span><span>{inr(quote.subtotal)}</span></div>
                {quote.discount > 0 && <div className="row" style={{ color: "var(--ok)" }}><span>Discount ({quote.coupon})</span><span>−{inr(quote.discount)}</span></div>}
                <div className="row"><span>Shipping</span><span>{quote.shipping ? inr(quote.shipping) : "Free"}</span></div>
                <div className="row total"><span>Total</span><span>{inr(quote.total)}</span></div>
              </div>
              {quote.payment_method === "cod" && <div className="cod-note"><div className="row"><span>Pay now (online)</span><b>{inr(quote.pay_now)}</b></div><div className="row"><span>Pay on delivery</span><b>{inr(quote.pay_on_delivery)}</b></div></div>}
              <button className="btn gold block" style={{ marginTop: 16 }} onClick={placeOrder} disabled={!!busy}>Pay {inr(quote.pay_now)} securely</button>
              <div className="secure">🔒 Secured by Razorpay</div>
            </>
          )}
        </aside>
      </div>

      {busy && <div className="busy" role="status"><BrandLoader size="lg" /><p>{busy}</p></div>}
      {mock && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Test payment">
          <div className="modal-card">
            <header><b>Iravath</b><small>{mock.order.order_number} · Test mode</small><div style={{ fontSize: 26, marginTop: 6 }}>{inr(mock.order.amount_paise / 100)}</div></header>
            <div className="body">
              <div className="methods"><div>UPI</div><div>Card</div><div>NetBanking</div></div>
              <p className="small">This is a simulated Razorpay checkout. With live keys, the real Razorpay window opens here.</p>
              <button className="btn gold block" id="mock-ok" onClick={async () => {
                const m = mock; setMock(null);
                try { m.resolve(await api<PayResult>("/api/checkout/mock-pay", { method: "POST", body: { razorpay_order_id: m.order.razorpay_order_id } })); }
                catch (e) { m.reject(e as Error); }
              }}>Simulate successful payment</button>
              <button className="btn ghost block" onClick={() => { const m = mock; setMock(null); m.reject(new Error("Payment cancelled")); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
