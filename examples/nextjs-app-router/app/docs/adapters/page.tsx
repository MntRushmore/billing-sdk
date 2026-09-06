import Link from "next/link";

export const metadata = {
  title: "Adapters - billing-sdk",
  description:
    "Use your existing billing provider. Your code stays the same.",
};

export default function Adapters() {
  return (
    <article className="docs-article">
      <h1>Adapters</h1>
      <p className="docs-lead">
        Use your existing billing provider. Your code stays the same.
      </p>

      <h2>Available adapters</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Adapter</th>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Link href="/docs/adapters/stripe">Stripe</Link>
            </td>
            <td>
              <span className="docs-badge docs-badge-green">Stable</span>
            </td>
            <td>Full Stripe Billing integration</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/adapters/polar">Polar</Link>
            </td>
            <td>
              <span className="docs-badge docs-badge-green">Stable</span>
            </td>
            <td>Polar.sh subscription support</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/adapters/mock">Mock</Link>
            </td>
            <td>
              <span className="docs-badge docs-badge-green">Stable</span>
            </td>
            <td>Testing without a real provider</td>
          </tr>
        </tbody>
      </table>

      <h2>How adapters work</h2>
      <p>Each adapter implements the same interface:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`interface BillingAdapter {
  getEntitlement(userId: string): Promise<Entitlement | null>;
  parseWebhook(body: string, signature: string): Promise<BillingEvent>;
}`}</code>
        </pre>
      </div>

      <p>Swap providers by changing one line:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";
// import { polar } from "@fuime/billing-sdk/polar";

const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  // provider: polar({ accessToken: process.env.POLAR_TOKEN }),
  // ...
});`}</code>
        </pre>
      </div>
    </article>
  );
}
