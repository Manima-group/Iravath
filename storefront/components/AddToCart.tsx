"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { firstInStock } from "@/lib/format";
import type { Product } from "@/lib/types";
import { useStore } from "./StoreProvider";
import WishlistButton from "./WishlistButton";

export default function AddToCart({ product: p }: { product: Product }) {
  const { addToCart, setCartOpen } = useStore();
  const router = useRouter();
  const [size, setSize] = useState(firstInStock(p.sizes));
  const [qty, setQty] = useState(1);
  const left = size ? p.sizes[size] ?? 0 : 0;
  return (
    <>
      <div style={{ marginTop: 18 }}><b>Size</b>{" "}
        {size && <span className={`small stock ${left <= 5 ? "low" : "in"}`}>· {left <= 5 ? `Only ${left} left` : "In stock"}</span>}</div>
      <div className="sizes" role="radiogroup" aria-label="Size">
        {Object.entries(p.sizes).map(([s, n]) => (
          <button key={s} className={`size ${s === size ? "on" : ""}`} disabled={n <= 0} role="radio" aria-checked={s === size}
            onClick={() => { setSize(s); setQty(1); }}>{s}</button>
        ))}
      </div>
      <div className="qty" aria-label="Quantity">
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button><span>{qty}</span>
        <button onClick={() => setQty((q) => Math.min(q + 1, left || 1, 10))} aria-label="Increase">+</button>
      </div>
      <div className="buy-row">
        <button className="btn" disabled={!size} onClick={() => { if (size) { addToCart(p, size, qty); setCartOpen(true); } }}>{size ? "Add to bag" : "Sold out"}</button>
        <button className="btn gold" disabled={!size} onClick={() => { if (size) { addToCart(p, size, qty); router.push("/checkout"); } }}>Buy now</button>
        <WishlistButton id={p.id} name={p.name} variant="text" />
      </div>
    </>
  );
}
