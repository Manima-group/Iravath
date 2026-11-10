import Link from "next/link";
import type { Category } from "@/lib/types";

export default function Footer({ categories }: { categories: Category[] }) {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <div className="footer-logo">
            <img src="/img/logo-mark-dark.png" alt="" width={84} height={78} />
            <img src="/img/logo-word-light.png" alt="Iravath, a premium clothing brand" width={240} height={56} />
          </div>
          <p>Considered menswear, cut and finished in India. Natural fabrics, honest pricing, made to be worn for years.</p>
        </div>
        <div>
          <h4>Shop</h4>
          <ul>{categories.map((c) => <li key={c.slug}><Link href={`/shop/${c.slug}`}>{c.name}</Link></li>)}</ul>
        </div>
        <div>
          <h4>Help</h4>
          <ul>
            <li><Link href="/account">My account &amp; orders</Link></li>
            <li><Link href="/shipping">Shipping &amp; COD</Link></li>
            <li><Link href="/returns">Returns &amp; exchanges</Link></li>
            <li><Link href="/wishlist">Wishlist</Link></li>
            <li><Link href="/contact">Contact us</Link></li>
          </ul>
        </div>
        <div>
          <h4>Payments</h4>
          <p className="pay-badges"><span>UPI</span><span>Cards</span><span>NetBanking</span><span>Wallets</span><span>COD</span></p>
          <p className="small">Secured by Razorpay · Shipped with Shiprocket</p>
        </div>
      </div>
      <div className="wrap legal">
        <span>© {new Date().getFullYear()} Iravath · Premium Menswear</span>
        <span>Powered by <a href="https://manima.co.in" target="_blank" rel="noopener">Manima AI-Tech Solutions</a></span>
      </div>
    </footer>
  );
}
