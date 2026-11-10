"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import Price from "@/components/Price";
import ProductImage from "@/components/ProductImage";
import { useStore } from "@/components/StoreProvider";
import { api } from "@/lib/client-api";
import { firstInStock } from "@/lib/format";
import type { Product } from "@/lib/types";

export default function WishlistPage() {
  const { ready, wishIds, toggleWish, addToCart, setCartOpen, toast, customer } = useStore();
  const [items, setItems] = useState<Product[] | null>(null);
  const [sizes, setSizes] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!ready) return;
    api<Product[]>("/api/wishlist").then(setItems).catch(() => setItems([]));
  }, [ready, customer?.id, wishIds.size]);

  if (!items) return <div className="wrap page-loader"><BrandLoader size="lg" /></div>;
  const size = (p: Product) => sizes[p.id] ?? firstInStock(p.sizes);

  return (
    <div className="wrap">
      <div className="page-head"><nav className="crumbs"><Link href="/">Home</Link> / Wishlist</nav><h1>My wishlist</h1></div>
      {!customer && items.length > 0 && (
        <p className="notice">Saved on this device only. <Link className="link" href="/account?next=/wishlist">Sign in</Link> to keep your wishlist on every device. We'll merge it automatically.</p>
      )}
      {items.length === 0 ? (
        <div className="empty"><h2>Your wishlist is empty</h2><p>Tap the ♡ on anything you like and it will wait for you here.</p><Link className="btn" href="/shop">Start shopping</Link></div>
      ) : (
        <>
          <table className="wish-table">
            <thead><tr><th>Product</th><th>Unit price</th><th>Stock status</th><th /><th /></tr></thead>
            <tbody>{items.map((p) => { const s = size(p); const any = firstInStock(p.sizes); return (
              <tr key={p.id}>
                <td><div className="wish-prod"><Link className="thumb" href={`/product/${p.slug}`}><ProductImage src={p.images?.[0]} alt={p.name} sizes="74px" /></Link>
                  <div><Link href={`/product/${p.slug}`}>{p.name}</Link><div className="small">{p.color} · {p.fabric}</div></div></div></td>
                <td><Price price={p.price} mrp={p.mrp} /></td>
                <td className={`stock ${any ? "in" : "low"}`}>{any ? "In stock" : "Out of stock"}</td>
                <td><select value={s || ""} onChange={(e) => setSizes({ ...sizes, [p.id]: e.target.value })} aria-label="Size">
                  {Object.entries(p.sizes).map(([k, n]) => <option key={k} value={k} disabled={n <= 0}>{k}</option>)}</select>{" "}
                  <button className="btn" style={{ padding: "9px 14px" }} disabled={!s || !(p.sizes[s] > 0)}
                    onClick={() => { if (s) { addToCart(p, s); toast(`${p.name} (${s}) added to bag`); } }}>Add to bag</button></td>
                <td><button className="remove" onClick={() => toggleWish(p.id)} aria-label={`Remove ${p.name}`}>✕</button></td>
              </tr>); })}</tbody>
          </table>
          <div className="wish-actions">
            <button className="btn ghost" onClick={() => { let n = 0; items.forEach((p) => { const s = size(p); if (s && p.sizes[s] > 0) { addToCart(p, s); n++; } }); toast(`${n} item${n === 1 ? "" : "s"} added to bag`); setCartOpen(true); }}>Add all to bag</button>
            <button className="btn ghost" onClick={async () => {
              const text = "My Iravath wishlist:\n" + items.map((p) => `• ${p.name}: ${location.origin}/product/${p.slug}`).join("\n");
              try { if (navigator.share) await navigator.share({ title: "My Iravath wishlist", text }); else { await navigator.clipboard.writeText(text); toast("Wishlist copied"); } } catch { /* cancelled */ }
            }}>Share wishlist</button>
          </div>
        </>
      )}
    </div>
  );
}
