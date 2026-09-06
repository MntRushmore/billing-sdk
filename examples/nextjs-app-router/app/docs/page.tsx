import Link from "next/link";

export const metadata = {
  title: "Introduction - billing-sdk",
  description: "Open-source TypeScript SDK for subscription billing.",
};

export default function DocsIndex() {
  return (
    <article className="docs-article">
      <h1>Introduction</h1>
      <p className="docs-lead">
        billing-sdk is a TypeScript SDK that provides a unified API for
        subscription billing. Check &quot;can this user access X?&quot;
        regardless of whether you use Stripe, Polar, or other providers.
      </p>

      <h2>Features</h2>
      <ul>
        <li>
          <strong>Provider adapters</strong> - Stripe, Polar, and mock adapter
          for testing
        </li>
        <li>
          <strong>Entitlement caching</strong> - Memory or Redis with
          auto-invalidation on webhooks
        </li>
        <li>
          <strong>Feature gating</strong> - Declarative plan-to-features mapping
          with <code>hasFeature()</code> checks
        </li>
        <li>
          <strong>Normalized webhooks</strong> - Same event types across all
          providers
        </li>
      </ul>

      <h2>Quick example</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>lib/billing.ts</span>
        </div>
        <pre>
          <code>{`import { createEnhancedClient } from '@fuime/billing-sdk'
import { stripe } from '@fuime/billing-sdk/stripe'

const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  cache: { ttlMs: 60_000 },
  plans: {
    'prod_pro': { features: ['api', 'export'] },
    'prod_enterprise': { features: '*' },
  }
})

// Check feature access
if (await billing.hasFeature(userId, 'api')) {
  // User has access
}`}</code>
        </pre>
      </div>

      <h2>Next steps</h2>
      <div className="docs-cards">
        <Link href="/docs/getting-started" className="docs-card">
          <h3>Quickstart</h3>
          <p>Get up and running in 5 minutes</p>
        </Link>
        <Link href="/docs/adapters" className="docs-card">
          <h3>Adapters</h3>
          <p>Stripe, Polar, and mock providers</p>
        </Link>
        <Link href="/docs/concepts/caching" className="docs-card">
          <h3>Caching</h3>
          <p>Memory and Redis cache options</p>
        </Link>
      </div>
    </article>
  );
}
