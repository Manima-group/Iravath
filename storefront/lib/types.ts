export type Category = { slug: string; name: string; blurb: string };
export type Product = {
  id: number; slug: string; name: string; description: string; price: number; mrp: number;
  fabric: string; color: string; color_hex: string; silhouette: string; rating: number; reviews: number;
  badge: string; sizes: Record<string, number>; images: string[]; is_active: boolean; category: Category;
};
export type Offer = { code: string; description: string };
export type Health = { ok: boolean; payments: "mock" | "razorpay"; cod_advance: number; free_shipping_threshold: number; shipping_fee: number; cod_max_order_value: number };
export type CartLine = { product_id: number; size: string; quantity: number; snapshot: { name: string; price: number; slug: string; image: string } };
export type QuoteLine = { product_id: number; name: string; size: string; quantity: number; unit_price: number; line_total: number };
export type Quote = {
  lines: QuoteLine[]; subtotal: number; discount: number; coupon: string; coupon_message: string; shipping: number; total: number;
  payment_method: "online" | "cod"; pay_now: number; pay_on_delivery: number; cod_available: boolean;
};
export type Address = { line1: string; line2?: string; city: string; state: string; pincode: string };
export type Customer = { id: number; email: string; name: string; phone: string; address: Partial<Address>; whatsapp_opt_in: boolean };
export type TimelineEvent = { kind: string; message: string; created_at: string };
export type Order = {
  number: string; status: string; payment_method: "online" | "cod"; customer: { name: string; email: string; phone: string };
  address: Address; subtotal: number; discount: number; shipping: number; total: number; pay_now: number; pay_on_delivery: number;
  coupon: string; razorpay_payment_id: string; items: { name: string; size: string; unit_price: number; quantity: number }[];
  created_at?: string; fulfilment_status: string; awb_code: string; courier_name: string; tracking_url: string; timeline: TimelineEvent[];
};
export type OrderSummary = Pick<Order, "number" | "status" | "fulfilment_status" | "payment_method" | "total" | "items"> & { created_at: string };
