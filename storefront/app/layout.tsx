import type { Metadata, Viewport } from "next";
import AnnouncementBar from "@/components/AnnouncementBar";
import CartDrawer from "@/components/CartDrawer";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { StoreProvider } from "@/components/StoreProvider";
import { BRAND, SITE_URL } from "@/lib/config";
import { getCategories, getOffers } from "@/lib/server-api";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} | ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  openGraph: { type: "website", siteName: BRAND.name, locale: "en_IN", images: [{ url: "/img/icon-512.png", width: 512, height: 512 }] },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/img/favicon.png", apple: "/img/apple-touch-icon.png" },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { themeColor: "#f7f1e6", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [categories, offers] = await Promise.all([getCategories(), getOffers()]);
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <StoreProvider>
          <AnnouncementBar offers={offers} />
          <Header categories={categories} />
          <main id="main">{children}</main>
          <Footer categories={categories} />
          <CartDrawer />
        </StoreProvider>
      </body>
    </html>
  );
}
