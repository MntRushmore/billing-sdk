import Link from "next/link";

export default function Home() {
  return (
    <main className="billing-landing">
      <Nav />
      <Hero />
      <CodeSection />
      <Features />
      <Providers />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <nav className="landing-nav">
      <Link className="landing-brand" href="/">
        billing-sdk
      </Link>
      <div className="landing-nav-links">
        <a href="https://github.com/MntRushmore/billing-sdk#readme">Docs</a>
        <a href="https://github.com/MntRushmore/billing-sdk">GitHub</a>
        <a
          className="landing-nav-cta"
          href="https://github.com/MntRushmore/billing-sdk#quickstart"
        >
          Get started
        </a>
      </div>
      <a
        className="landing-mobile-menu"
        href="https://github.com/MntRushmore/billing-sdk#readme"
      >
        Docs
      </a>
    </nav>
  );
}

function Hero() {
  return (
    <section className="landing-hero">
      <div className="landing-hero-copy">
        <h1>
          Check entitlements.
          <br />
          Cache automatically.
        </h1>
        <p>
          Open-source TypeScript SDK for subscription billing.
          <span className="landing-hero-brand-line">
            Stripe, Polar, and more. One typed SDK.
          </span>
        </p>
        <div className="landing-hero-actions">
          <a
            className="landing-button landing-button-primary"
            href="https://github.com/MntRushmore/billing-sdk#quickstart"
          >
            Start building ↗
          </a>
          <a
            className="landing-button landing-button-secondary"
            href="https://github.com/MntRushmore/billing-sdk"
          >
            View on GitHub
          </a>
        </div>
      </div>
      <div className="landing-install">
        <div className="landing-install-box">
          <span className="landing-install-prefix">$</span>
          <span>npm install @fuime/billing-sdk</span>
        </div>
      </div>
    </section>
  );
}

function CodeSection() {
  return (
    <section className="landing-code-section">
      <div className="landing-container">
        <h2>
          Define your plans.
          <br />
          Check access anywhere.
        </h2>
        <div className="landing-code-flow">
          <div className="landing-code-panel">
            <div className="landing-code-header">
              <span>lib/billing.ts</span>
              <span className="landing-code-language">TypeScript</span>
            </div>
            <pre className="landing-code">
              <code>
                <span>
                  <span className="kw">import</span> {"{"}{" "}
                  <span className="fn">createEnhancedClient</span> {"}"}{" "}
                  <span className="kw">from</span>{" "}
                  <span className="str">&apos;@fuime/billing-sdk&apos;</span>
                </span>
                <span>
                  <span className="kw">import</span> {"{"}{" "}
                  <span className="fn">stripe</span> {"}"}{" "}
                  <span className="kw">from</span>{" "}
                  <span className="str">
                    &apos;@fuime/billing-sdk/stripe&apos;
                  </span>
                </span>
                <span className="sp" />
                <span>
                  <span className="kw">const</span> billing ={" "}
                  <span className="fn">createEnhancedClient</span>
                  ({"{"}
                </span>
                <span>
                  {"  "}provider: <span className="fn">stripe</span>({"{"}{" "}
                  apiKey: process.env.STRIPE_KEY {"}"}),
                </span>
                <span>
                  {"  "}cache: {"{"} ttlMs: 60_000 {"}"},
                  <span className="cmt"> // Auto-invalidates on webhooks</span>
                </span>
                <span>{"  "}plans: {"{"}</span>
                <span>
                  {"    "}
                  <span className="str">&apos;prod_pro&apos;</span>: {"{"}{" "}
                  features: [<span className="str">&apos;api&apos;</span>,{" "}
                  <span className="str">&apos;export&apos;</span>] {"}"},
                </span>
                <span>
                  {"    "}
                  <span className="str">&apos;prod_enterprise&apos;</span>:{" "}
                  {"{"} features: <span className="str">&apos;*&apos;</span>{" "}
                  {"}"},
                </span>
                <span>{"  }"}</span>
                <span>{"})"}</span>
              </code>
            </pre>
          </div>
          <div className="landing-code-panel">
            <div className="landing-code-header">
              <span>app/api/route.ts</span>
              <span className="landing-code-language">TypeScript</span>
            </div>
            <pre className="landing-code">
              <code>
                <span className="cmt">
                  // Check feature access (uses cache)
                </span>
                <span>
                  <span className="kw">if</span> (
                  <span className="kw">await</span> billing.
                  <span className="fn">hasFeature</span>(userId,{" "}
                  <span className="str">&apos;api&apos;</span>)) {"{"}
                </span>
                <span>
                  {"  "}
                  <span className="cmt">// User has access</span>
                </span>
                <span>{"}"}</span>
                <span className="sp" />
                <span className="cmt">// Get entitlement details</span>
                <span>
                  <span className="kw">const</span> ent ={" "}
                  <span className="kw">await</span> billing.
                  <span className="fn">getEntitlement</span>(userId)
                </span>
                <span className="cmt">
                  // {"{"} active: true, productId: &apos;prod_pro&apos;,
                  periodEnd: Date {"}"}
                </span>
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="landing-features">
      <div className="landing-container">
        <h2>Features</h2>
        <div className="landing-feature-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">⚡</div>
            <h3>Entitlement Cache</h3>
            <p>
              Memory or Redis. Configurable TTL. Auto-invalidates when webhooks
              arrive. Stop hitting Stripe on every request.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🎯</div>
            <h3>Feature Gating</h3>
            <p>
              Declarative plan → features config. Check access with one line.
              Supports wildcards for enterprise plans.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🔔</div>
            <h3>Webhook Handling</h3>
            <p>
              Signature verification, typed events, automatic cache
              invalidation. All providers normalize to the same event types.
            </p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">🧪</div>
            <h3>Mock Adapter</h3>
            <p>
              Full state control for testing. Create subscriptions, trigger
              webhooks, test edge cases—no Stripe sandbox needed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Providers() {
  return (
    <section className="landing-providers">
      <div className="landing-container">
        <div className="landing-providers-heading">
          <h2>Providers</h2>
          <p>
            Use the billing provider you already have. Your code stays the same.
          </p>
        </div>
        <div className="landing-provider-band">
          <div>
            <svg viewBox="0 0 24 24">
              <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
            </svg>
            <span>Stripe</span>
          </div>
          <div>
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
            </svg>
            <span>Polar</span>
          </div>
          <div className="landing-provider-soon">
            <svg viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            <span>+ More soon</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer landing-container">
      <div className="landing-footer-brand">
        <Link href="/">billing-sdk</Link>
        <p>Open source TypeScript billing infrastructure.</p>
      </div>
      <nav className="landing-footer-nav">
        <div className="landing-footer-group">
          <span className="landing-footer-label">Product</span>
          <a href="https://github.com/MntRushmore/billing-sdk#readme">
            Docs ↗
          </a>
          <a href="https://github.com/MntRushmore/billing-sdk#quickstart">
            Quickstart ↗
          </a>
        </div>
        <div className="landing-footer-group">
          <span className="landing-footer-label">Package</span>
          <a href="https://www.npmjs.com/package/@fuime/billing-sdk">npm ↗</a>
          <a href="https://github.com/MntRushmore/billing-sdk/blob/main/LICENSE">
            MIT ↗
          </a>
        </div>
        <div className="landing-footer-group">
          <span className="landing-footer-label">Project</span>
          <a href="https://github.com/MntRushmore/billing-sdk">GitHub ↗</a>
          <a href="https://github.com/MntRushmore/billing-sdk/issues">
            Issues ↗
          </a>
        </div>
      </nav>
    </footer>
  );
}
