import type { MetadataRoute } from "next";
import { mediaUrl, SITE_URL } from "@/lib/config";
import { getSitemapData } from "@/lib/server-api";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories } = await getSitemapData();
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/shop`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...categories.map((c) => ({ url: `${SITE_URL}/shop/${c}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.map((p) => ({
      url: `${SITE_URL}/product/${p.slug}`, lastModified: p.updated_at ? new Date(p.updated_at) : now,
      changeFrequency: "weekly" as const, priority: 0.7, ...(p.image ? { images: [mediaUrl(p.image)] } : {}),
    })),
    ...["shipping", "returns", "contact"].map((s) => ({ url: `${SITE_URL}/${s}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
