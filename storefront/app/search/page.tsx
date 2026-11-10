import type { Metadata } from "next";
import Link from "next/link";
import SortableGrid from "@/components/SortableGrid";
import { getProducts } from "@/lib/server-api";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };
type Props = { searchParams: Promise<{ q?: string }> };

export default async function Search({ searchParams }: Props) {
  const q = ((await searchParams).q || "").trim().slice(0, 80);
  const { items } = q ? await getProducts({ q, limit: 100 }) : { items: [] };
  return (
    <div className="wrap">
      <div className="page-head"><nav className="crumbs"><Link href="/">Home</Link> / Search</nav><h1>{q ? `Results for “${q}”` : "Search"}</h1></div>
      {items.length ? <SortableGrid products={items} /> : (
        <div className="empty"><h2>Nothing found</h2><p>Try a different word, like linen, kurta or navy.</p><Link className="btn" href="/shop">Browse all</Link></div>
      )}
    </div>
  );
}
