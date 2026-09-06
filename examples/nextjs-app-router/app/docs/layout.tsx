import Link from "next/link";
import "../globals.css";

const sidebarItems = [
  {
    title: "Get Started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/getting-started" },
    ],
  },
  {
    title: "Adapters",
    items: [
      { title: "Overview", href: "/docs/adapters" },
      { title: "Stripe", href: "/docs/adapters/stripe" },
      { title: "Polar", href: "/docs/adapters/polar" },
      { title: "Mock", href: "/docs/adapters/mock" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { title: "Caching", href: "/docs/concepts/caching" },
      { title: "Feature Gating", href: "/docs/concepts/feature-gating" },
      { title: "Webhooks", href: "/docs/concepts/webhooks" },
    ],
  },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <Link href="/" className="docs-logo">
            billing-sdk
          </Link>
          <span className="docs-version">v0.1.0</span>
        </div>
        <nav className="docs-nav">
          {sidebarItems.map((section) => (
            <div key={section.title} className="docs-nav-section">
              <span className="docs-nav-title">{section.title}</span>
              <ul>
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="docs-nav-link">
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="docs-sidebar-footer">
          <a
            href="https://github.com/MntRushmore/billing-sdk"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </aside>
      <main className="docs-content">{children}</main>
    </div>
  );
}
