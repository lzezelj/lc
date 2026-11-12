import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { DesignPlayground } from "./design-playground";

export const metadata: Metadata = {
  title: "LC",
  description: "A self-hosted real-time chat prototype.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        {process.env.NODE_ENV === "development" && <DesignPlayground />}
      </body>
    </html>
  );
}
