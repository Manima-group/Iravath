"use client";
import { useMemo, useState } from "react";
import ProductCard from "./ProductCard";
import type { Product } from "@/lib/types";

const SORTS = [["featured", "Featured"], ["newest", "Newest"], ["rating", "Top rated"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]] as const;

/** Sorting happens in the browser so category pages stay statically generated (ISR) for SEO. */
export default function SortableGrid({ products }: { products: Product[] }) {
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("featured");
  const items = useMemo(() => {
    const cmp: Record<string, (a: Product, b: Product) => number> = {
      newest: (a, b) => b.id - a.id, rating: (a, b) => b.rating - a.rating,
      price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price,
    };
    return cmp[sort] ? [...products].sort(cmp[sort]) : products;
  }, [products, sort]);
  return (
    <>
      <div className="grid-bar">
        <p className="small">{products.length} product{products.length === 1 ? "" : "s"}</p>
        <label className="small">Sort{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            {SORTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="grid">{items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} />)}</div>
    </>
  );
}
