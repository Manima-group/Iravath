import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import ProductImage from "@/components/ProductImage";
import { BRAND, SITE_URL } from "@/lib/config";
import { inr } from "@/lib/format";
import { getCategories, getHealth, getProducts } from "@/lib/server-api";

export const revalidate = 60; // ISR: refresh at most once a minute (instantly via /api/revalidate)

export default async function Home() {
  const [best, all, categories, health] = await Promise.all([
    getProducts({ sort: "rating", limit: 8 }), getProducts({ limit: 100 }), getCategories(), getHealth(),
  ]);
  const withPhoto = all.items.filter((p) => p.images?.length);
  const hero = (withPhoto.length >= 3 ? withPhoto : all.items).slice(0, 3);
  const catCover = (slug: string) => {
    const inCat = all.items.filter((p) => p.category.slug === slug);
    return inCat.find((p) => p.images?.length) || inCat[0];
  };
  const orgLd = {
    "@context": "https://schema.org", "@type": "ClothingStore", name: BRAND.name, url: SITE_URL,
    logo: `${SITE_URL}/img/icon-512.png`, description: BRAND.description, address: { "@type": "PostalAddress", addressLocality: "Hyderabad", addressRegion: "Telangana", addressCountry: "IN" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }} />
      <div className="wrap">
        <section className="hero">
          <div>
            <div className="eyebrow">The Festive Edit</div>
            <h1>Quiet luxury,<br />woven in India.</h1>
            <p>Linen shirts, hand-embroidered kurtas and tailored essentials in natural fabrics. Cut for Indian summers, finished to last for years.</p>
            <div className="cta"><Link className="btn" href="/shop">Shop the collection</Link><Link className="btn ghost" href="/shop/kurtas">Explore kurtas</Link></div>
          </div>
          <div className="hero-art">
            {hero.map((p, i) => (
              <Link key={p.id} href={`/product/${p.slug}`} aria-label={p.name}>
                <ProductImage src={p.images?.[0]} alt={p.name} sizes={i === 0 ? "(max-width: 820px) 50vw, 300px" : "(max-width: 820px) 50vw, 260px"} priority={i === 0} />
              </Link>
            ))}
          </div>
        </section>
      </div>
      <div className="wrap usp">
        <div><b>Natural fabrics</b>Linen, mul, handloom</div>
        <div><b>Free shipping</b>On orders over {inr(health?.free_shipping_threshold ?? 1999)}</div>
        <div><b>COD available</b>{inr(health?.cod_advance ?? 200)} advance, rest on delivery</div>
        <div><b>7-day exchange</b>Size swaps, no fuss</div>
      </div>
      <section className="block wrap">
        <div className="section-head"><div><div className="eyebrow">Shop by category</div><h2>Find your fit</h2></div></div>
        <div className="cat-grid">
          {categories.map((c) => { const p = catCover(c.slug); return (
            <Link key={c.slug} className="cat-tile" href={`/shop/${c.slug}`}>
              <div className="art"><ProductImage src={p?.images?.[0]} alt={c.name} sizes="(max-width: 520px) 45vw, 180px" /></div>
              <b>{c.name}</b>
            </Link>); })}
        </div>
      </section>
      <section className="block wrap">
        <div className="section-head"><div><div className="eyebrow">Most loved</div><h2>Bestsellers</h2></div><Link className="link" href="/shop">View all</Link></div>
        <div className="grid">{best.items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
      </section>
      <section className="block wrap" style={{ textAlign: "center", maxWidth: 640 }}>
        <div className="eyebrow">Iravath circle</div><h2>10% off your first order</h2>
        <p className="small">Use code <b>IRAVATH10</b> at checkout. Create an account to keep your wishlist and orders in one place.</p>
        <Link className="btn ghost" href="/account">Sign in or create an account</Link>
      </section>
    </>
  );
}
