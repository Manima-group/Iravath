export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
/** Backend URL used by the Next.js server (can be a private/internal address). */
export const SERVER_API_URL = (process.env.API_URL_INTERNAL || API_URL).replace(/\/$/, "");
export const BRAND = {
  name: "Iravath",
  tagline: "Premium Menswear",
  description: "Iravath: premium Indian menswear. Linen shirts, chikankari kurtas, tailored trousers and festive sets, cut and finished in India.",
};
/** Turn a backend media path into an absolute URL. */
export const mediaUrl = (path?: string) => (!path ? "" : path.startsWith("http") ? path : `${API_URL}${path}`);
