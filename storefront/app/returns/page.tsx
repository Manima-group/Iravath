import type { Metadata } from "next";
export const metadata: Metadata = { title: "Returns & exchanges", description: "Free size exchanges within 7 days at Iravath.", alternates: { canonical: "/returns" } };
export default function Returns() {
  return (
    <div className="wrap prose">
      <h1>Returns &amp; exchanges</h1>
      <p>Free size exchanges within 7 days of delivery. Products must be unworn, unwashed and with tags attached.</p>
      <p>Prepaid orders can be refunded to the original payment method within 5–7 working days. For COD orders, the online advance and the amount paid on delivery are refunded by bank transfer or UPI.</p>
    </div>
  );
}
