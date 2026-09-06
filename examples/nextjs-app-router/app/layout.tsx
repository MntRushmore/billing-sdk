import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing SDK Example",
  description: "Example Next.js app using @fuime/billing-sdk",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem" }}>
        <header style={{ marginBottom: "2rem" }}>
          <h1 style={{ margin: 0 }}>Billing SDK Example</h1>
          <p style={{ color: "#666" }}>
            Demonstrating @fuime/billing-sdk with Next.js App Router
          </p>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
