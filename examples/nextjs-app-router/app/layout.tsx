import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "billing-sdk - Check entitlements. Cache automatically.",
  description:
    "TypeScript SDK for subscription billing. Entitlement caching, feature gating, and webhook handling for Stripe, Polar, and more.",
  openGraph: {
    title: "billing-sdk",
    description: "Check entitlements. Cache automatically.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="container nav-inner">
            <a href="/" className="nav-logo">
              billing-sdk
            </a>
            <div className="nav-links">
              <a href="https://github.com/MntRushmore/billing-sdk#readme">
                Docs
              </a>
              <a href="https://github.com/MntRushmore/billing-sdk">GitHub</a>
              <a href="https://www.npmjs.com/package/@fuime/billing-sdk">npm</a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="footer">
          <div className="container">
            <p>
              MIT License &middot;{" "}
              <a href="https://github.com/MntRushmore/billing-sdk">
                GitHub
              </a>{" "}
              &middot;{" "}
              <a href="https://www.npmjs.com/package/@fuime/billing-sdk">npm</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
