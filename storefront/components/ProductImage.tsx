import Image from "next/image";
import { mediaUrl } from "@/lib/config";

/** Real product photography. Products without photos get a branded placeholder (no fake illustrations). */
export default function ProductImage({ src, alt, sizes, priority = false, className = "" }:
  { src?: string; alt: string; sizes: string; priority?: boolean; className?: string }) {
  if (!src) {
    return (
      <div className={`ph-empty ${className}`} role="img" aria-label={`${alt}: photo coming soon`}>
        <img src="/img/logo-mark.png" alt="" />
        <span>Photo coming soon</span>
      </div>
    );
  }
  return <Image src={mediaUrl(src)} alt={alt} fill sizes={sizes} priority={priority} className={`ph ${className}`} quality={85} />;
}
