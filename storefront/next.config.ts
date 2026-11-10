import type { NextConfig } from "next";

const api = new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");
const isLocalApi = ["localhost", "127.0.0.1"].includes(api.hostname);

const nextConfig: NextConfig = {
  images: {
    // Product photos uploaded from the admin panel are served by the FastAPI backend under /media
    remotePatterns: [{ protocol: api.protocol.replace(":", "") as "http" | "https", hostname: api.hostname, port: api.port, pathname: "/media/**" }],
    qualities: [75, 85],
    dangerouslyAllowLocalIP: isLocalApi, // only so local dev can optimise images from localhost:8000
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] }];
  },
};

export default nextConfig;
