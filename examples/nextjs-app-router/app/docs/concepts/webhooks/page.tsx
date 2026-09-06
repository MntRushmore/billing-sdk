export const metadata = {
  title: "Webhooks - billing-sdk",
  description: "Automatic cache invalidation and normalized event handling.",
};

export default function Webhooks() {
  return (
    <article className="docs-article">
      <h1>Webhooks</h1>
      <p className="docs-lead">
        Automatic cache invalidation and normalized event handling.
      </p>

      <p>
        Webhooks keep your cache in sync with your payment provider. When a
        subscription changes, the SDK automatically invalidates the cached
        entitlement.
      </p>

      <h2>Setting up webhooks</h2>

      <h3>1. Create the endpoint</h3>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>app/api/webhooks/billing/route.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  try {
    const event = await billing.parseWebhook(body, signature);

    console.log(\`[billing] \${event.type} for user \${event.userId}\`);

    // Optional: Handle specific events
    if (event.type === "subscription.deleted") {
      await sendCancellationEmail(event.userId);
    }

    return new Response("ok");
  } catch (err) {
    console.error("[billing] Webhook error:", err);
    return new Response("Invalid signature", { status: 400 });
  }
}`}</code>
        </pre>
      </div>

      <h3>2. Configure your provider</h3>
      <p>
        <strong>Stripe:</strong>
      </p>
      <ol>
        <li>Dashboard → Developers → Webhooks</li>
        <li>
          Add endpoint: <code>https://yourapp.com/api/webhooks/billing</code>
        </li>
        <li>
          Select: <code>customer.subscription.created</code>,{" "}
          <code>customer.subscription.updated</code>,{" "}
          <code>customer.subscription.deleted</code>
        </li>
      </ol>

      <p>
        <strong>Polar:</strong>
      </p>
      <ol>
        <li>Organization settings → Webhooks</li>
        <li>
          Add endpoint: <code>https://yourapp.com/api/webhooks/billing</code>
        </li>
        <li>Select subscription events</li>
      </ol>

      <h2>Normalized events</h2>
      <p>All providers emit the same event types:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`type BillingEvent = {
  type: "subscription.created" | "subscription.updated" | "subscription.deleted";
  userId: string;
  productId: string;
  timestamp: Date;
  raw: unknown; // Original provider payload
};`}</code>
        </pre>
      </div>

      <h3>Event mapping</h3>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Provider Event</th>
            <th>SDK Event</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Stripe <code>customer.subscription.created</code>
            </td>
            <td>
              <code>subscription.created</code>
            </td>
          </tr>
          <tr>
            <td>
              Stripe <code>customer.subscription.updated</code>
            </td>
            <td>
              <code>subscription.updated</code>
            </td>
          </tr>
          <tr>
            <td>
              Stripe <code>customer.subscription.deleted</code>
            </td>
            <td>
              <code>subscription.deleted</code>
            </td>
          </tr>
          <tr>
            <td>
              Polar <code>subscription.created</code>
            </td>
            <td>
              <code>subscription.created</code>
            </td>
          </tr>
          <tr>
            <td>
              Polar <code>subscription.canceled</code>
            </td>
            <td>
              <code>subscription.deleted</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Automatic cache invalidation</h2>
      <p>
        When <code>parseWebhook</code> is called, the SDK:
      </p>
      <ol>
        <li>Verifies the signature</li>
        <li>Parses the event</li>
        <li>
          <strong>Automatically invalidates the cache</strong> for the affected
          user
        </li>
        <li>Returns the normalized event</li>
      </ol>

      <h2>Handling webhook retries</h2>
      <p>
        Payment providers retry failed webhooks. Make your handler idempotent:
      </p>
      <div className="docs-code-block">
        <pre>
          <code>{`export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  try {
    const event = await billing.parseWebhook(body, signature);

    // Idempotent: Cache invalidation is safe to repeat
    // Your custom logic should also be idempotent

    return new Response("ok");
  } catch (err) {
    // Return 200 for events we don't handle
    // Return 4xx only for signature failures
    if (err.message.includes("signature")) {
      return new Response("Invalid signature", { status: 400 });
    }
    return new Response("ok");
  }
}`}</code>
        </pre>
      </div>

      <h2>Local development</h2>
      <p>Use provider CLIs to forward webhooks locally:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`# Stripe
stripe listen --forward-to localhost:3000/api/webhooks/billing

# The CLI outputs a webhook secret - use it for local dev
STRIPE_WEBHOOK_SECRET=whsec_xxx`}</code>
        </pre>
      </div>

      <h2>Webhook security</h2>
      <p>
        <strong>Always verify webhook signatures.</strong> Never trust the
        payload without verification.
      </p>
      <p>
        The SDK handles signature verification automatically when you provide
        the webhook secret:
      </p>
      <div className="docs-code-block">
        <pre>
          <code>{`const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!, // Required
  }),
});`}</code>
        </pre>
      </div>
    </article>
  );
}
