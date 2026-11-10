import { inr, offPct } from "@/lib/format";

export default function Price({ price, mrp }: { price: number; mrp: number }) {
  const off = offPct(price, mrp);
  return (
    <div className="price">
      <b>{inr(price)}</b>
      {off > 0 && (<><s>{inr(mrp)}</s><em>{off}% off</em></>)}
    </div>
  );
}

export function Stars({ rating, reviews }: { rating: number; reviews: number }) {
  if (!reviews) return null;
  const r = Math.round(rating);
  return <div className="stars" aria-label={`Rated ${rating} out of 5`}>{"★".repeat(r)}{"☆".repeat(5 - r)}<span>{rating} ({reviews})</span></div>;
}
