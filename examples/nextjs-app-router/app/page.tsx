export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <h1>
            Check entitlements.{" "}
            <span className="hero-gradient">Cache automatically.</span>
          </h1>
          <p>
            TypeScript SDK for subscription billing. One API for entitlements,
            feature gating, and webhooks across Stripe, Polar, and more.
          </p>
          <div className="hero-buttons">
            <a
              href="https://github.com/MntRushmore/billing-sdk#readme"
              className="btn btn-primary"
            >
              Get Started
            </a>
            <a
              href="https://github.com/MntRushmore/billing-sdk"
              className="btn btn-secondary"
            >
              View on GitHub
            </a>
          </div>
          <div className="install">
            <span className="install-prefix">$</span>
            <span>npm install @fuime/billing-sdk</span>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="code-section">
        <div className="container">
          <div className="code-block">
            <div className="code-header">
              <span className="code-dot" />
              <span className="code-dot" />
              <span className="code-dot" />
              <span style={{ marginLeft: "0.5rem" }}>lib/billing.ts</span>
            </div>
            <div className="code-content">
              <pre>
                <code>
                  <span className="code-keyword">import</span> {"{"}{" "}
                  createEnhancedClient {"}"}{" "}
                  <span className="code-keyword">from</span>{" "}
                  <span className="code-string">"@fuime/billing-sdk"</span>;
                  {"\n"}
                  <span className="code-keyword">import</span> {"{"} stripe {"}"}{" "}
                  <span className="code-keyword">from</span>{" "}
                  <span className="code-string">
                    "@fuime/billing-sdk/stripe"
                  </span>
                  ;{"\n\n"}
                  <span className="code-keyword">const</span> billing ={" "}
                  <span className="code-function">createEnhancedClient</span>
                  ({"{"}
                  {"\n"}
                  {"  "}provider:{" "}
                  <span className="code-function">stripe</span>({"{"} apiKey:{" "}
                  <span className="code-string">
                    process.env.STRIPE_SECRET_KEY
                  </span>{" "}
                  {"}"}),{"\n"}
                  {"  "}
                  <span className="code-comment">
                    // Cache entitlements for 60s, auto-invalidate on webhooks
                  </span>
                  {"\n"}
                  {"  "}cache: {"{"} ttlMs: 60_000 {"},"} {"\n"}
                  {"  "}
                  <span className="code-comment">
                    // Define what each plan can access
                  </span>
                  {"\n"}
                  {"  "}plans: {"{"}
                  {"\n"}
                  {"    "}
                  <span className="code-string">"prod_pro"</span>: {"{"}{" "}
                  features: [
                  <span className="code-string">"api"</span>,{" "}
                  <span className="code-string">"export"</span>] {"},"} {"\n"}
                  {"    "}
                  <span className="code-string">"prod_enterprise"</span>: {"{"}{" "}
                  features: <span className="code-string">"*"</span> {"}"},{" "}
                  {"\n"}
                  {"  "}
                  {"}"},{"\n"}
                  {"}"});
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Usage Example */}
      <section className="code-section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="code-block">
            <div className="code-header">
              <span className="code-dot" />
              <span className="code-dot" />
              <span className="code-dot" />
              <span style={{ marginLeft: "0.5rem" }}>app/api/route.ts</span>
            </div>
            <div className="code-content">
              <pre>
                <code>
                  <span className="code-comment">
                    // Check if user can access a feature
                  </span>
                  {"\n"}
                  <span className="code-keyword">if</span> (
                  <span className="code-keyword">await</span> billing.
                  <span className="code-function">hasFeature</span>(userId,{" "}
                  <span className="code-string">"api"</span>)) {"{"}
                  {"\n"}
                  {"  "}
                  <span className="code-comment">// User has API access</span>
                  {"\n"}
                  {"}"} <span className="code-keyword">else</span> {"{"}
                  {"\n"}
                  {"  "}
                  <span className="code-keyword">return</span>{" "}
                  <span className="code-function">Response</span>.
                  <span className="code-function">json</span>({"{"} error:{" "}
                  <span className="code-string">"Upgrade to Pro"</span> {"}"},{" "}
                  {"{"} status: 403 {"}"});{"\n"}
                  {"}"}
                  {"\n\n"}
                  <span className="code-comment">
                    // Get full entitlement details (cached)
                  </span>
                  {"\n"}
                  <span className="code-keyword">const</span> entitlement ={" "}
                  <span className="code-keyword">await</span> billing.
                  <span className="code-function">getEntitlement</span>(userId);
                  {"\n"}
                  <span className="code-comment">
                    // {"{"} active: true, productId: "prod_pro", periodEnd: Date
                    {"}"}
                  </span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="container">
          <h2>Why billing-sdk?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">{"⚡"}</div>
              <h3>Entitlement Caching</h3>
              <p>
                Memory or Redis cache with configurable TTL. Stop hitting Stripe
                on every request. Auto-invalidates on webhook events.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">{"🎯"}</div>
              <h3>Feature Gating</h3>
              <p>
                Declarative plan → features config. Check access with one line:{" "}
                <code>hasFeature(userId, "api")</code>. Supports wildcards for
                enterprise plans.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">{"🔔"}</div>
              <h3>Webhook Handling</h3>
              <p>
                Signature verification, typed events, automatic cache
                invalidation. All providers normalize to the same event types.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">{"🧪"}</div>
              <h3>Test Without Stripe</h3>
              <p>
                Mock adapter with full state control. Create subscriptions,
                trigger webhooks, test edge cases—no sandbox needed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Providers */}
      <section className="providers">
        <div className="container">
          <h2>Works with your payment provider</h2>
          <div className="provider-grid">
            <div className="provider-logo">
              <svg viewBox="0 0 60 25" fill="currentColor">
                <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.02 1.04-.06 1.48zm-3.67-3.14c0-1.61-.77-2.98-2.34-2.98-1.52 0-2.43 1.3-2.55 2.98h4.89zM34.77 13.12c0-5.4 3.37-7.82 6.93-7.82 2.16 0 3.75.65 4.87 1.57l-1.91 3.23c-.67-.56-1.53-.88-2.48-.88-1.97 0-3.32 1.42-3.32 3.91 0 2.55 1.41 3.95 3.37 3.95.91 0 1.84-.35 2.56-1l1.78 3.3a7.33 7.33 0 0 1-4.87 1.57c-3.77 0-6.93-2.44-6.93-7.83zM23.53 5.88l3.9-.76v3.92h3.95v3.6h-3.95v3.72c0 1.4.62 1.98 1.53 1.98.59 0 1.17-.2 1.7-.4l.9 3.35c-.87.4-2.06.66-3.44.66-3.03 0-4.78-1.83-4.78-5.4V8.64h-2.07v-3.6h2.26v-.76zm-8.89 8.18c.37 1.13 1.35 1.97 2.94 1.97.97 0 1.91-.32 2.52-.76l1.78 3.1c-1.07.73-2.67 1.17-4.45 1.17-4.27 0-6.89-2.82-6.89-7.54 0-4.48 2.62-7.7 6.57-7.7 3.92 0 6.04 3.07 6.04 7.14 0 .74-.08 1.54-.19 2.16h-8.32v.46zm-.04-2.97h4.56c-.11-1.5-.85-2.82-2.21-2.82-1.34 0-2.18 1.2-2.35 2.82zM0 5.97l4.05-.79v10.77c0 2.77 1.32 3.35 2.63 3.35.64 0 1.19-.07 1.64-.2V5.97l4.05-.79v14.66c-1.42.58-3.43.96-5.58.96-4.05 0-6.79-1.47-6.79-6.2V5.97z" />
              </svg>
              Stripe
            </div>
            <div className="provider-logo">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Polar
            </div>
            <div className="provider-logo" style={{ opacity: 0.5 }}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              More soon
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="container">
          <h2>Stop writing billing boilerplate</h2>
          <p>
            One SDK for entitlements, caching, and feature gating. TypeScript
            native.
          </p>
          <div className="hero-buttons">
            <a
              href="https://github.com/MntRushmore/billing-sdk#readme"
              className="btn btn-primary"
            >
              Read the Docs
            </a>
            <a
              href="https://www.npmjs.com/package/@fuime/billing-sdk"
              className="btn btn-secondary"
            >
              View on npm
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
