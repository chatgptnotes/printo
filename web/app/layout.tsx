import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Printo — AI BOQ Generator",
  description: "AI BOQ extraction and export workflow for construction drawings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
