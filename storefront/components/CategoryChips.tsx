import Link from "next/link";

export default function CategoryChips({ categories, active }: { categories: { slug: string; name: string }[]; active: string }) {
  return (
    <div className="toolbar"><div className="chips">
      <Link className={`chip ${!active ? "on" : ""}`} href="/shop">All</Link>
      {categories.map((c) => <Link key={c.slug} className={`chip ${c.slug === active ? "on" : ""}`} href={`/shop/${c.slug}`}>{c.name}</Link>)}
    </div></div>
  );
}
