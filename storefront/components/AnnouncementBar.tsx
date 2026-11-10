"use client";
import { useEffect, useState } from "react";
import type { Offer } from "@/lib/types";

export default function AnnouncementBar({ offers }: { offers: Offer[] }) {
  const base = "Free shipping above ₹1,999 · Cash on Delivery with ₹200 advance · Easy 7-day exchanges";
  const msgs = [...offers.map((o) => ({ text: o.description || "Special offer", code: o.code })), { text: base, code: "" }];
  const [i, setI] = useState(0);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    if (msgs.length < 2) return;
    const t = setInterval(() => { setFade(true); setTimeout(() => { setI((x) => (x + 1) % msgs.length); setFade(false); }, 250); }, 4500);
    return () => clearInterval(t);
  }, [msgs.length]);
  const m = msgs[i % msgs.length];
  return (
    <div className={`announce ${fade ? "swap" : ""}`}>
      {m.text}{m.code && <> · Use code <b>{m.code}</b></>}
    </div>
  );
}
