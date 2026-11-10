import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToCart from "@/components/AddToCart";
import Gallery from "@/components/Gallery";
import Price, { Stars } from "@/components/Price";
import ProductCard from "@/components/ProductCard";
import { mediaUrl, SITE_URL } from "@/lib/config";
import { inr } from "@/lib/format";
import { getHealth, getProduct, getProducts } from "@/lib/server-api";

export const revalidate = 60; // ISR: refresh at most once a minute (instantly via /api/revalidate)
type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return (await getProducts({ limit: 100 })).items.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p) return { title: "Product not found", robots: { index: false } };
  const desc = `${p.name} in ${p.fabric || "premium fabric"}, ${p.color}. ${p.description}`.slice(0, 158);
  const img = p.images?.[0] ? mediaUrl(p.images[0]) : `${SITE_URL}/img/icon-512.png`;
  return {
    title: `${p.name} | ${p.category.name}`,
    description: desc,
    alternates: { canonical: `/product/${p.slug}` },
    openGraph: { type: "website", title: p.name, description: desc, url: `/product/${p.slug}`, images: [{ url: img, alt: p.name }] },
    twitter: { card: "summary_large_image", title: p.name, description: desc, images: [img] },
    other: { "product:price:amount": String(p.price), "product:price:currency": "INR" },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [p, health] = await Promise.all([getProduct(slug), getHealth()]);
  if (!p) notFound();
  const related = (await getProducts({ category: p.category.slug, limit: 8 })).items.filter((x) => x.id !== p.id).slice(0, 4);
  const inStock = Object.values(p.sizes).some((n) => n > 0);
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description, sku: `IRV-${p.id}`,
      brand: { "@type": "Brand", name: "Iravath" }, color: p.color, material: p.fabric, category: p.category.name,
      image: p.images?.length ? p.images.map(mediaUrl) : [`${SITE_URL}/img/icon-512.png`],
      offers: {
        "@type": "Offer", url: `${SITE_URL}/product/${p.slug}`, priceCurrency: "INR", price: p.price,
        availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", itemCondition: "https://schema.org/NewCondition",
        seller: { "@type": "Organization", name: "Iravath" },
      },
      ...(p.reviews ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews } } : {}),
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: p.category.name, item: `${SITE_URL}/shop/${p.category.slug}` },
        { "@type": "ListItem", position: 3, name: p.name, item: `${SITE_URL}/product/${p.slug}` },
      ],
    },
  ];
  const freeAt = health?.free_shipping_threshold ?? 1999, fee = health?.shipping_fee ?? 99, adv = health?.cod_advance ?? 200;
  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <nav className="crumbs" style={{ paddingTop: 26 }} aria-label="Breadcrumb">
        <Link href="/">Home</Link> / <Link href={`/shop/${p.category.slug}`}>{p.category.name}</Link> / {p.name}
      </nav>
      <div className="pdp">
        <Gallery images={p.images || []} name={p.name} />
        <div className="pdp-info">
          <div className="eyebrow">{p.category.name}{p.badge ? ` · ${p.badge}` : ""}</div>
          <h1>{p.name}</h1>
          <Stars rating={p.rating} reviews={p.reviews} />
          <Price price={p.price} mrp={p.mrp} />
          <p className="small">Inclusive of all taxes · or pay {inr(adv)} now with Cash on Delivery</p>
          <p>{p.description}</p>
          <AddToCart product={p} />
          <div className="details">
            <details open><summary>Fabric &amp; care</summary><p>{p.fabric}{p.color ? ` · Colour: ${p.color}` : ""}<br />Gentle machine wash cold, dry in shade, warm iron.</p></details>
            <details><summary>Shipping &amp; COD</summary><p>Free shipping above {inr(freeAt)}, otherwise {inr(fee)}. Dispatch in 24–48 hours with tracking by SMS, email and WhatsApp. Cash on Delivery: pay {inr(adv)} online to confirm, balance on delivery.</p></details>
            <details><summary>Exchanges</summary><p>Free size exchange within 7 days of delivery. Items must be unworn with tags.</p></details>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <section className="block"><div className="section-head"><h2>You may also like</h2></div>
          <div className="grid">{related.map((r) => <ProductCard key={r.id} p={r} />)}</div></section>
      )}
    </div>
  );
}
