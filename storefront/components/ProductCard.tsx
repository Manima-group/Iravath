import Link from "next/link";
import Price, { Stars } from "./Price";
import ProductImage from "./ProductImage";
import WishlistButton from "./WishlistButton";
import type { Product } from "@/lib/types";

export default function ProductCard({ p, priority = false }: { p: Product; priority?: boolean }) {
  const sizes = "(max-width: 820px) 50vw, (max-width: 1000px) 33vw, 300px";
  return (
    <article className="card">
      <Link className="media" href={`/product/${p.slug}`} aria-label={p.name}>
        {p.badge && <span className="badge">{p.badge}</span>}
        <ProductImage src={p.images?.[0]} alt={p.name} sizes={sizes} priority={priority} />
        {p.images?.[1] && <ProductImage src={p.images[1]} alt="" sizes={sizes} className="alt" />}
      </Link>
      <WishlistButton id={p.id} name={p.name} />
      <div className="info">
        <div className="cat">{p.category.name}</div>
        <Link className="name" href={`/product/${p.slug}`}>{p.name}</Link>
        <Price price={p.price} mrp={p.mrp} />
        <Stars rating={p.rating} reviews={p.reviews} />
      </div>
    </article>
  );
}
