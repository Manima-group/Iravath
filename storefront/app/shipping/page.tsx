import type { Metadata } from "next";
import { inr } from "@/lib/format";
import { getHealth } from "@/lib/server-api";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Shipping & Cash on Delivery", description: "Iravath shipping times, charges and Cash on Delivery policy.", alternates: { canonical: "/shipping" } };

export default async function Shipping() {
  const h = await getHealth();
  return (
    <div className="wrap prose">
      <h1>Shipping &amp; Cash on Delivery</h1>
      <p>Free shipping on orders above <b>{inr(h?.free_shipping_threshold ?? 1999)}</b>; {inr(h?.shipping_fee ?? 99)} otherwise. Orders dispatch in 24–48 hours and arrive in 3–6 working days across India. You'll get tracking updates by email and WhatsApp.</p>
      <h2>Cash on Delivery</h2>
      <p>Pay <b>{inr(h?.cod_advance ?? 200)}</b> online at checkout to confirm a COD order. The balance is collected on delivery in cash or UPI. COD is available on orders up to {inr(h?.cod_max_order_value ?? 10000)}.</p>
    </div>
  );
}
