"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "./StoreProvider";
import type { Category } from "@/lib/types";

export default function Header({ categories }: { categories: Category[] }) {
  const { wishIds, cartCount, setCartOpen, customer } = useStore();
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => setMenu(false), [pathname]);

  return (
    <header className={`site-header ${menu ? "menu-open" : ""}`}>
      <div className="wrap header-row">
        <button className="icon-btn menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
          <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <Link href="/" className="logo" aria-label="Iravath home">
          <img className="logo-mark" src="/img/logo-mark.png" alt="" width={51} height={46} />
          <img className="logo-word" src="/img/logo-word.png" alt="Iravath" width={160} height={30} />
        </Link>
        <nav className="main-nav" aria-label="Categories">
          <Link href="/shop" className={pathname === "/shop" ? "active" : ""}>Shop all</Link>
          {categories.slice(0, 5).map((c) => (
            <Link key={c.slug} href={`/shop/${c.slug}`} className={pathname === `/shop/${c.slug}` ? "active" : ""}>{c.name}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <form className="search" role="search" onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q")?.toString().trim();
            router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/shop");
          }}>
            <input type="search" name="q" placeholder="Search linen, kurta, navy…" aria-label="Search products" />
          </form>
          <Link href="/account" className="icon-btn" aria-label={customer ? "My account" : "Sign in"} title={customer ? customer.email : "Sign in"}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
            {customer && <b className="dot" />}
          </Link>
          <Link href="/wishlist" className="icon-btn" aria-label="Wishlist">
            <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.1 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z" /></svg>
            {wishIds.size > 0 && <b className="count">{wishIds.size}</b>}
          </Link>
          <button className="icon-btn" onClick={() => setCartOpen(true)} aria-label="Shopping bag">
            <svg viewBox="0 0 24 24"><path d="M6 7h12l-1.2 12.2a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-.8L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>
            {cartCount > 0 && <b className="count">{cartCount}</b>}
          </button>
        </div>
      </div>
    </header>
  );
}
