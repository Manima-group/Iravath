import type { Metadata } from "next";
export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };
export default function L({ children }: { children: React.ReactNode }) { return children; }
