export default function BrandLoader({ size = "", label = "Loading" }: { size?: "" | "lg" | "sm"; label?: string }) {
  return (
    <div className={`brand-loader ${size}`} role="status" aria-label={label}>
      <i className="mark" />
    </div>
  );
}
