import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "billing-sdk - Check entitlements. Cache automatically.",
  description:
    "Open-source TypeScript SDK for subscription billing. Entitlement caching, feature gating, and webhooks for Stripe, Polar, and more.",
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
