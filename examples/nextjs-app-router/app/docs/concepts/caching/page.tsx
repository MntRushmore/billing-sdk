export const metadata = {
  title: "Caching - billing-sdk",
  description: "Memory and Redis cache options with automatic invalidation.",
};

export default function Caching() {
  return (
    <article className="docs-article">
      <h1>Caching</h1>
      <p className="docs-lead">
        Memory and Redis cache options with automatic invalidation.
      </p>

      <p>
        The SDK caches entitlement lookups to avoid hitting your payment
        provider on every request.
      </p>

      <h2>Memory cache (default)</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  cache: {
    ttlMs: 60_000, // 1 minute
  },
});`}</code>
        </pre>
      </div>

      <p>Memory cache is perfect for:</p>
      <ul>
        <li>Single-server deployments</li>
        <li>Development and testing</li>
        <li>Low-traffic applications</li>
      </ul>

      <h2>Redis cache</h2>
      <p>For multi-server deployments, use Redis:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";
import { redisCache } from "@fuime/billing-sdk/cache/redis";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  cache: redisCache({
    client: redis,
    ttlMs: 60_000,
    prefix: "billing:", // Optional key prefix
  }),
});`}</code>
        </pre>
      </div>

      <h2>How caching works</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`Request: hasFeature("user_123", "api")
         │
         ▼
    ┌─────────┐
    │  Cache  │ ──── Hit? ──── Return cached entitlement
    └────┬────┘
         │ Miss
         ▼
    ┌──────────┐
    │ Provider │ ──── Fetch from Stripe/Polar
    └────┬─────┘
         │
         ▼
    Store in cache with TTL
         │
         ▼
    Return entitlement`}</code>
        </pre>
      </div>

      <h2>Automatic invalidation</h2>
      <p>
        When a webhook arrives, the SDK automatically invalidates the cache for
        that user:
      </p>
      <div className="docs-code-block">
        <pre>
          <code>{`// In your webhook handler
const event = await billing.parseWebhook(body, signature);
// Cache for event.userId is automatically cleared`}</code>
        </pre>
      </div>

      <p>This means:</p>
      <ul>
        <li>User upgrades → immediate access to new features</li>
        <li>User cancels → immediate loss of access</li>
        <li>No stale data between webhook and next request</li>
      </ul>

      <h2>Manual invalidation</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`// Invalidate a single user
billing.invalidateCache("user_123");

// Invalidate all users (use sparingly)
billing.clearCache();`}</code>
        </pre>
      </div>

      <h2>Cache configuration</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ttlMs</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>
              <code>60000</code>
            </td>
            <td>Time-to-live in milliseconds</td>
          </tr>
          <tr>
            <td>
              <code>prefix</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>&quot;billing:&quot;</code>
            </td>
            <td>Key prefix (Redis only)</td>
          </tr>
        </tbody>
      </table>

      <h2>Disabling cache</h2>
      <p>For testing or debugging:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  cache: { ttlMs: 0 }, // Disable caching
});`}</code>
        </pre>
      </div>
      <p>
        <strong>Warning:</strong> Disabling cache means every{" "}
        <code>hasFeature</code> or <code>getEntitlement</code> call hits your
        provider&apos;s API.
      </p>
    </article>
  );
}
