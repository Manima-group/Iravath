import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap empty" style={{ padding: "90px 20px" }}>
      <img src="/img/logo-mark.png" alt="" width={90} style={{ margin: "0 auto 16px", opacity: 0.8 }} />
      <h1>Page not found</h1>
      <p>The page you're looking for has moved or no longer exists.</p>
      <Link className="btn" href="/shop">Browse the collection</Link>
    </div>
  );
}
