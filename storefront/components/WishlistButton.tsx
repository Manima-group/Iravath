"use client";
import { useStore } from "./StoreProvider";

const Heart = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.1 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.8 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z" /></svg>
);

export default function WishlistButton({ id, name, variant = "icon" }: { id: number; name: string; variant?: "icon" | "text" }) {
  const { wishIds, toggleWish } = useStore();
  const on = wishIds.has(id);
  if (variant === "text")
    return <button className="btn ghost" onClick={() => toggleWish(id)} aria-pressed={on}>{on ? "♥ Saved" : "♡ Wishlist"}</button>;
  return (
    <button className={`heart ${on ? "on" : ""}`} onClick={(e) => { e.preventDefault(); toggleWish(id); }} aria-pressed={on} aria-label={`${on ? "Remove" : "Save"} ${name} ${on ? "from" : "to"} wishlist`}>
      <Heart />
    </button>
  );
}
