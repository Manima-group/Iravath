// Server-side data fetching (Server Components). Responses are cached and revalidated (ISR).
import "server-only";
import { SERVER_API_URL } from "./config";
import type { Category, Health, Offer, Product } from "./types";

export const REVALIDATE = 60;

async function get<T>(path: string, fallback: T, revalidate = REVALIDATE): Promise<T> {
  try {
    const res = await fetch(SERVER_API_URL + path, { next: { revalidate, tags: ["catalog"] } });
    if (res.status === 404) return fallback;
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    // Backend down during build/revalidation: render with fallback instead of failing the page
    console.error("[api]", (e as Error).message);
    return fallback;
  }
}

export const getCategories = () => get<Category[]>("/api/categories", []);
export const getOffers = () => get<Offer[]>("/api/offers", []);
export const getHealth = () => get<Health | null>("/api/health", null);
export const getProducts = (params: Record<string, string | number | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  return get<{ items: Product[]; total: number }>(`/api/products?${qs}`, { items: [], total: 0 });
};
export const getProduct = (slug: string) => get<Product | null>(`/api/products/${encodeURIComponent(slug)}`, null);
export const getSitemapData = () =>
  get<{ products: { slug: string; updated_at: string | null; image: string | null }[]; categories: string[] }>("/api/sitemap-data", { products: [], categories: [] }, 3600);
