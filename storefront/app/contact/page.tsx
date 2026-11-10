import type { Metadata } from "next";
export const metadata: Metadata = { title: "Contact us", description: "Get in touch with Iravath, Hyderabad.", alternates: { canonical: "/contact" } };
export default function Contact() {
  return (
    <div className="wrap prose">
      <h1>Contact us</h1>
      <p>Iravath · Hyderabad, Telangana. Reply to any order email and we'll get back to you within one working day.</p>
    </div>
  );
}
