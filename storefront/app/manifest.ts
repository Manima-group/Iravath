import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Iravath | Premium Menswear", short_name: "Iravath", start_url: "/", display: "standalone",
    background_color: "#f7f1e6", theme_color: "#f7f1e6",
    icons: [{ src: "/img/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/img/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
