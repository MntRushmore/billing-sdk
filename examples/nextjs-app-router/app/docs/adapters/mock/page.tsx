export const metadata = {
  title: "Mock Adapter - billing-sdk",
  description: "Test billing flows without hitting real payment APIs.",
};

export default function MockAdapter() {
  return (
    <article className="docs-article">
      <h1>Mock</h1>
      <p className="docs-lead">
        Test billing flows without hitting real payment APIs.
      </p>

      <h2>Setup</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>lib/billing.test.ts</span>
        </div>
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { mock } from "@fuime/billing-sdk/mock";

const mockAdapter = mock();

const billing = createEnhancedClient({
  provider: mockAdapter,
  cache: { ttlMs: 60_000 },
  plans: {
    prod_pro: { features: ["api", "export"] },
    prod_enterprise: { features: "*" },
  },
});`}</code>
        </pre>
      </div>

      <h2>Creating test subscriptions</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`// Add a subscription for testing
mockAdapter.addSubscription({
  userId: "user_123",
  productId: "prod_pro",
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
});

// Now entitlement checks work
const hasAccess = await billing.hasFeature("user_123", "api");
// true`}</code>
        </pre>
      </div>

      <h2>Simulating webhooks</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`// Trigger a webhook event
const event = mockAdapter.triggerWebhook({
  type: "subscription.updated",
  userId: "user_123",
  productId: "prod_enterprise",
});

// The cache is automatically invalidated`}</code>
        </pre>
      </div>

      <h2>Test scenarios</h2>

      <h3>Test upgrade flow</h3>
      <div className="docs-code-block">
        <pre>
          <code>{`test("user can upgrade", async () => {
  const mockAdapter = mock();
  const billing = createEnhancedClient({
    provider: mockAdapter,
    plans: {
      prod_free: { features: ["basic"] },
      prod_pro: { features: ["basic", "api", "export"] },
    },
  });

  // Start on free plan
  mockAdapter.addSubscription({
    userId: "user_123",
    productId: "prod_free",
    status: "active",
  });

  expect(await billing.hasFeature("user_123", "api")).toBe(false);

  // Simulate upgrade
  mockAdapter.updateSubscription("user_123", {
    productId: "prod_pro",
  });

  // Clear cache to see new state
  billing.invalidateCache("user_123");

  expect(await billing.hasFeature("user_123", "api")).toBe(true);
});`}</code>
        </pre>
      </div>

      <h3>Test cancellation</h3>
      <div className="docs-code-block">
        <pre>
          <code>{`test("cancelled user loses access", async () => {
  mockAdapter.addSubscription({
    userId: "user_123",
    productId: "prod_pro",
    status: "active",
  });

  expect(await billing.hasFeature("user_123", "api")).toBe(true);

  // Cancel subscription
  mockAdapter.cancelSubscription("user_123");
  billing.invalidateCache("user_123");

  expect(await billing.hasFeature("user_123", "api")).toBe(false);
});`}</code>
        </pre>
      </div>

      <h2>Resetting state</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`beforeEach(() => {
  mockAdapter.reset(); // Clears all subscriptions
});`}</code>
        </pre>
      </div>
    </article>
  );
}
