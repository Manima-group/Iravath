import type { Metadata } from "next";
import Link from "next/link";
import CategoryChips from "@/components/CategoryChips";
import SortableGrid from "@/components/SortableGrid";
import { getCategories, getProducts } from "@/lib/server-api";

export const revalidate = 60; // ISR: refresh at most once a minute (instantly via /api/revalidate)
export const metadata: Metadata = {
  title: "Shop all menswear",
  description: "Shop Iravath: linen shirts, chikankari kurtas, tailored trousers, polos and festive ethnic sets. Free shipping above ₹1,999, COD available.",
  alternates: { canonical: "/shop" },
};

export default async function ShopAll() {
  const [{ items }, categories] = await Promise.all([getProducts({ limit: 100 }), getCategories()]);
  return (
    <div className="wrap">
      <div className="page-head"><nav className="crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link> / Shop</nav><h1>All menswear</h1></div>
      <CategoryChips categories={categories} active="" />
      <SortableGrid products={items} />
    </div>
  );
}
