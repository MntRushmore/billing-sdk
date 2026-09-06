export const metadata = {
  title: "Polar Adapter - billing-sdk",
  description: "Polar.sh adapter for open-source friendly billing.",
};

export default function PolarAdapter() {
  return (
    <article className="docs-article">
      <h1>Polar</h1>
      <p className="docs-lead">
        Polar.sh adapter for open-source friendly billing.
      </p>

      <h2>Setup</h2>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>lib/billing.ts</span>
        </div>
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { polar } from "@fuime/billing-sdk/polar";

export const billing = createEnhancedClient({
  provider: polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
  }),
  cache: { ttlMs: 60_000 },
  plans: {
    // Use Polar product IDs
    "your-product-id": { features: ["api", "export"] },
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
          <code>{`POLAR_ACCESS_TOKEN=polar_xxx
POLAR_WEBHOOK_SECRET=xxx`}</code>
        </pre>
      </div>

      <h2>How it works</h2>
      <p>The adapter uses the Polar API to:</p>
      <ol>
        <li>
          <strong>Get entitlements</strong> - Fetches subscriptions by customer
          email or ID
        </li>
        <li>
          <strong>Parse webhooks</strong> - Verifies signatures and normalizes
          Polar events
        </li>
      </ol>

      <h2>Webhook events</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Polar Event</th>
            <th>SDK Event</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>subscription.created</code>
            </td>
            <td>
              <code>subscription.created</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>subscription.updated</code>
            </td>
            <td>
              <code>subscription.updated</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>subscription.canceled</code>
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
          <span>app/api/webhooks/polar/route.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-polar-signature")!;

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

      <h2>Polar Dashboard setup</h2>
      <ol>
        <li>Go to your organization settings in Polar</li>
        <li>
          Navigate to <strong>Webhooks</strong>
        </li>
        <li>
          Add endpoint: <code>https://yourapp.com/api/webhooks/polar</code>
        </li>
        <li>
          Copy the signing secret to <code>POLAR_WEBHOOK_SECRET</code>
        </li>
      </ol>
    </article>
  );
}
