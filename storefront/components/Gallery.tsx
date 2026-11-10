"use client";
import { useState } from "react";
import ProductImage from "./ProductImage";

export default function Gallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  if (!images.length)
    return <div className="gallery"><div className="g-main"><ProductImage alt={name} sizes="(max-width: 820px) 100vw, 640px" priority /></div></div>;
  return (
    <div className="gallery">
      <div className="g-main"><ProductImage src={images[active]} alt={`${name}, photo ${active + 1}`} sizes="(max-width: 820px) 100vw, 640px" priority /></div>
      {images.length > 1 && (
        <div className="g-thumbs" role="tablist" aria-label="Product photos">
          {images.map((src, i) => (
            <button key={src} className={i === active ? "on" : ""} onClick={() => setActive(i)} role="tab" aria-selected={i === active} aria-label={`Photo ${i + 1}`}>
              <ProductImage src={src} alt="" sizes="96px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
