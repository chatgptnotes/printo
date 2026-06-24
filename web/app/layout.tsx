import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP RealSoft — Drawing Intelligence",
  description: "AI compliance & extraction gateway for construction drawings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
