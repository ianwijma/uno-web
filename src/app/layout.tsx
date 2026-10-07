import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNO Web · A table for your friends",
  description:
    "Create a private lobby and play classic UNO together. Peer-to-peer, browser-owned games.",
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
