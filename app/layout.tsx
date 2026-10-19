import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LC",
  description: "A self-hosted real-time chat prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
