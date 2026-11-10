"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import type { CartLine, Customer, Health, Product } from "@/lib/types";

type LoginResult = { token: string; customer: Customer; merged: { wishlist_merged: number; orders_linked: number }; is_new: boolean };

type Store = {
  ready: boolean;
  health: Health;
  // cart
  cart: CartLine[];
  addToCart: (p: Product, size: string, qty?: number) => void;
  setQty: (index: number, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartSubtotal: number;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  // wishlist
  wishIds: Set<number>;
  toggleWish: (id: number) => Promise<void>;
  refreshWish: () => Promise<void>;
  // account
  customer: Customer | null;
  completeLogin: (r: LoginResult) => Promise<void>;
  logout: () => void;
  setCustomer: (c: Customer) => void;
  // ui
  toast: (msg: string) => void;
};

const DEFAULT_HEALTH: Health = { ok: true, payments: "mock", cod_advance: 200, free_shipping_threshold: 1999, shipping_fee: 99, cod_max_order_value: 10000 };
const Ctx = createContext<Store | null>(null);

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* storage blocked */ } },
  raw(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
};

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [health, setHealth] = useState<Health>(DEFAULT_HEALTH);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [wishIds, setWishIds] = useState<Set<number>>(new Set());
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2600);
  }, []);

  const refreshWish = useCallback(async () => {
    try { setWishIds(new Set((await api<Product[]>("/api/wishlist")).map((p) => p.id))); } catch { /* offline */ }
  }, []);

  // boot: guest session id, cart, token
  useEffect(() => {
    if (!ls.raw("irv_sid")) ls.set("irv_sid", "s_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24));
    setCart(ls.get<CartLine[]>("irv_cart", []));
    setCustomerState(ls.get<Customer | null>("irv_customer", null));
    (async () => {
      try { setHealth({ ...DEFAULT_HEALTH, ...(await api<Health>("/api/health")) }); } catch { /* keep defaults */ }
      if (ls.raw("irv_token")) {
        try { const c = await api<Customer>("/api/account/me"); setCustomerState(c); ls.set("irv_customer", c); }
        catch { ls.set("irv_token", null); ls.set("irv_customer", null); setCustomerState(null); }
      }
      await refreshWish();
      setReady(true);
    })();
  }, [refreshWish]);

  const saveCart = (next: CartLine[]) => { setCart(next); ls.set("irv_cart", next); };
  const addToCart = useCallback((p: Product, size: string, qty = 1) => {
    setCart((prev) => {
      const max = Math.min(p.sizes[size] ?? 10, 10);
      const next = [...prev];
      const i = next.findIndex((l) => l.product_id === p.id && l.size === size);
      if (i >= 0) next[i] = { ...next[i], quantity: Math.min(next[i].quantity + qty, max) };
      else next.push({ product_id: p.id, size, quantity: Math.min(qty, max), snapshot: { name: p.name, price: p.price, slug: p.slug, image: p.images?.[0] || "" } });
      ls.set("irv_cart", next);
      return next;
    });
  }, []);
  const setQty = useCallback((index: number, qty: number) => {
    setCart((prev) => {
      const next = [...prev];
      if (qty <= 0) next.splice(index, 1); else next[index] = { ...next[index], quantity: Math.min(qty, 10) };
      ls.set("irv_cart", next);
      return next;
    });
  }, []);

  const toggleWish = useCallback(async (id: number) => {
    const on = wishIds.has(id);
    try {
      await api(`/api/wishlist/${id}`, { method: on ? "DELETE" : "POST" });
      setWishIds((prev) => { const n = new Set(prev); if (on) n.delete(id); else n.add(id); return n; });
      toast(on ? "Removed from wishlist" : "Saved to wishlist ♥");
    } catch (e) { toast((e as Error).message); }
  }, [wishIds, toast]);

  const completeLogin = useCallback(async (r: LoginResult) => {
    ls.set("irv_token", r.token);
    ls.set("irv_customer", r.customer);
    setCustomerState(r.customer);
    await refreshWish();
  }, [refreshWish]);

  const logout = useCallback(() => {
    ls.set("irv_token", null); ls.set("irv_customer", null);
    setCustomerState(null); refreshWish(); toast("Signed out");
  }, [refreshWish, toast]);

  const setCustomer = useCallback((c: Customer) => { setCustomerState(c); ls.set("irv_customer", c); }, []);

  const value = useMemo<Store>(() => ({
    ready, health, cart, addToCart, setQty, clearCart: () => saveCart([]),
    cartCount: cart.reduce((s, l) => s + l.quantity, 0), cartSubtotal: cart.reduce((s, l) => s + l.snapshot.price * l.quantity, 0),
    cartOpen, setCartOpen, wishIds, toggleWish, refreshWish, customer, completeLogin, logout, setCustomer, toast,
  }), [ready, health, cart, addToCart, setQty, cartOpen, wishIds, toggleWish, refreshWish, customer, completeLogin, logout, setCustomer, toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={`toast ${toastMsg ? "show" : ""}`} role="status" aria-live="polite">{toastMsg}</div>
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside <StoreProvider>");
  return s;
}
