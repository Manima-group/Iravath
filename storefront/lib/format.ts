export const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const offPct = (price: number, mrp: number) => (mrp > price ? Math.round((1 - price / mrp) * 100) : 0);
export const firstInStock = (sizes: Record<string, number>) => Object.entries(sizes).find(([, n]) => n > 0)?.[0];
export const FULFILMENT_LABEL: Record<string, string> = {
  unfulfilled: "Confirmed", processing: "Packed", shipped: "Shipped", out_for_delivery: "Out for delivery",
  delivered: "Delivered", cancelled: "Cancelled", rto: "Returned",
};
