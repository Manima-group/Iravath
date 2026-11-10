import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CategoryChips from "@/components/CategoryChips";
import SortableGrid from "@/components/SortableGrid";
import { SITE_URL } from "@/lib/config";
import { getCategories, getProducts } from "@/lib/server-api";

export const revalidate = 60; // ISR: refresh at most once a minute (instantly via /api/revalidate)
type Props = { params: Promise<{ category: string }> };

export async function generateStaticParams() {
  return (await getCategories()).map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const cat = (await getCategories()).find((c) => c.slug === category);
  if (!cat) return { title: "Not found" };
  return {
    title: `${cat.name} for men`,
    description: `${cat.blurb}. Shop ${cat.name.toLowerCase()} for men at Iravath: premium fabrics, free shipping above ₹1,999 and Cash on Delivery.`,
    alternates: { canonical: `/shop/${cat.slug}` },
    openGraph: { title: `${cat.name} for men | Iravath`, url: `/shop/${cat.slug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const categories = await getCategories();
  const cat = categories.find((c) => c.slug === category);
  if (!cat) notFound();
  const { items } = await getProducts({ category, limit: 100 });
  const ld = {
    "@context": "https://schema.org", "@type": "ItemList", name: cat.name,
    itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}/product/${p.slug}`, name: p.name })),
  };
  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="page-head">
        <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> / <Link href="/shop">Shop</Link> / {cat.name}</nav>
        <h1>{cat.name}</h1><p className="small">{cat.blurb}</p>
      </div>
      <CategoryChips categories={categories} active={cat.slug} />
      {items.length ? <SortableGrid products={items} /> : <div className="empty"><h2>New pieces arriving soon</h2><Link className="btn" href="/shop">Browse all</Link></div>}
    </div>
  );
}
