"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap empty" style={{ padding: "90px 20px" }}>
      <h1>Something went wrong</h1>
      <p>Please try again in a moment.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
