import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IncoPay Chat Demo",
  description: "Pay-per-inference private AI chat on Solana + Inco Lightning",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
