"use client";
import Link from "next/link";
import { useEffect } from "react";
import { inr } from "@/lib/format";
import ProductImage from "./ProductImage";
import { useStore } from "./StoreProvider";

export default function CartDrawer() {
  const { cart, cartOpen, setCartOpen, setQty, cartSubtotal, health } = useStore();
  const close = () => setCartOpen(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.body.classList.toggle("cart-open", cartOpen);
    return () => document.removeEventListener("keydown", onKey);
  });
  const need = health.free_shipping_threshold - cartSubtotal;
  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" aria-label="Shopping bag" aria-hidden={!cartOpen}>
        <div className="drawer-head"><h3>Your bag</h3><button className="icon-btn" onClick={close} aria-label="Close">✕</button></div>
        <div className="drawer-body">
          {cart.length === 0 ? (
            <div className="empty" style={{ padding: "50px 0" }}><h3>Your bag is empty</h3><p className="small">Add something you love.</p></div>
          ) : cart.map((l, i) => (
            <div className="line" key={`${l.product_id}-${l.size}`}>
              <Link className="thumb" href={`/product/${l.snapshot.slug}`} onClick={close}>
                <ProductImage src={l.snapshot.image} alt={l.snapshot.name} sizes="72px" />
              </Link>
              <div>
                <div className="nm">{l.snapshot.name}</div>
                <div className="meta">Size {l.size} · {inr(l.snapshot.price)}</div>
                <div className="qty">
                  <button onClick={() => setQty(i, l.quantity - 1)} aria-label="Decrease">−</button><span>{l.quantity}</span>
                  <button onClick={() => setQty(i, l.quantity + 1)} aria-label="Increase">+</button>
                </div>
              </div>
              <div style={{ textAlign: "right" }}><b>{inr(l.snapshot.price * l.quantity)}</b><br />
                <button className="link small" onClick={() => setQty(i, 0)}>Remove</button></div>
            </div>
          ))}
        </div>
        <div className="drawer-foot">
          {cart.length === 0 ? <Link className="btn block" href="/shop" onClick={close}>Shop now</Link> : (
            <>
              <div className="ship-meter">{need > 0 ? <>Add <b>{inr(need)}</b> more for free shipping</> : "🎉 You've unlocked free shipping"}
                <div className="bar"><i style={{ width: `${Math.min(100, (cartSubtotal / health.free_shipping_threshold) * 100)}%` }} /></div></div>
              <div className="row total" style={{ border: 0, margin: 0 }}><span>Subtotal</span><span>{inr(cartSubtotal)}</span></div>
              <p className="small" style={{ margin: "2px 0 12px" }}>Coupons and shipping calculated at checkout.</p>
              <Link className="btn gold block" href="/checkout" onClick={close}>Checkout</Link>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
