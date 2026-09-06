export const metadata = {
  title: "Stripe Adapter - billing-sdk",
  description: "Stripe Billing adapter for subscriptions and entitlements.",
};

export default function StripeAdapter() {
  return (
    <article className="docs-article">
      <h1>Stripe</h1>
      <p className="docs-lead">
        Stripe Billing adapter for subscriptions and entitlements.
      </p>

      <h2>Setup</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>lib/billing.ts</span>
        </div>
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

export const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  }),
  cache: { ttlMs: 60_000 },
  plans: {
    prod_pro: { features: ["api", "export"] },
    prod_enterprise: { features: "*" },
  },
});`}</code>
        </pre>
      </div>

      <h2>Environment variables</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>.env.local</span>
        </div>
        <pre>
          <code>{`STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx`}</code>
        </pre>
      </div>

      <h2>How it works</h2>
      <p>The adapter uses the Stripe API to:</p>
      <ol>
        <li>
          <strong>Get entitlements</strong> - Fetches the customer&apos;s active
          subscriptions by <code>metadata.userId</code>
        </li>
        <li>
          <strong>Parse webhooks</strong> - Verifies signatures and normalizes
          events
        </li>
      </ol>

      <h3>Customer metadata</h3>
      <p>
        The adapter looks up customers by <code>metadata.userId</code>. When
        creating a Stripe customer:
      </p>
      <div className="docs-code-block">
        <pre>
          <code>{`const customer = await stripe.customers.create({
  email: user.email,
  metadata: {
    userId: user.id, // Required for the SDK
  },
});`}</code>
        </pre>
      </div>

      <h2>Webhook events</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Stripe Event</th>
            <th>SDK Event</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>customer.subscription.created</code>
            </td>
            <td>
              <code>subscription.created</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>customer.subscription.updated</code>
            </td>
            <td>
              <code>subscription.updated</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>customer.subscription.deleted</code>
            </td>
            <td>
              <code>subscription.deleted</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Webhook endpoint</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>app/api/webhooks/stripe/route.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  try {
    const event = await billing.parseWebhook(body, signature);
    console.log(\`\${event.type} for user \${event.userId}\`);
    return new Response("ok");
  } catch (err) {
    return new Response("Invalid signature", { status: 400 });
  }
}`}</code>
        </pre>
      </div>

      <h2>Stripe Dashboard setup</h2>
      <ol>
        <li>
          Go to <strong>Developers → Webhooks</strong> in the Stripe Dashboard
        </li>
        <li>
          Add an endpoint: <code>https://yourapp.com/api/webhooks/stripe</code>
        </li>
        <li>
          Select events: <code>customer.subscription.*</code>
        </li>
        <li>
          Copy the signing secret to <code>STRIPE_WEBHOOK_SECRET</code>
        </li>
      </ol>
    </article>
  );
}
