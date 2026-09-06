export const metadata = {
  title: "Quickstart - billing-sdk",
  description: "Create a Stripe client and check your first entitlement.",
};

export default function Quickstart() {
  return (
    <article className="docs-article">
      <h1>Quickstart</h1>
      <p className="docs-lead">
        Create a Stripe client and check your first entitlement.
      </p>

      <p>Set your Stripe secret key:</p>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>.env.local</span>
        </div>
        <pre>
          <code>STRIPE_SECRET_KEY=sk_xxx</code>
        </pre>
      </div>

      <p>Install the SDK:</p>
      <div className="docs-code-block">
        <pre>
          <code>npm install @fuime/billing-sdk</code>
        </pre>
      </div>

      <p>Create the client and check an entitlement:</p>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>lib/billing.ts</span>
        </div>
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

export const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_SECRET_KEY! }),
  cache: { ttlMs: 60_000 }, // Cache for 1 minute
  plans: {
    prod_pro: { features: ["api", "export", "analytics"] },
    prod_enterprise: { features: "*" }, // All features
  },
});`}</code>
        </pre>
      </div>

      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>app/api/data/route.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";

export async function GET(request: Request) {
  const userId = getUserId(request);

  if (!(await billing.hasFeature(userId, "api"))) {
    return Response.json({ error: "Upgrade required" }, { status: 403 });
  }

  // User has API access
  return Response.json({ data: "..." });
}`}</code>
        </pre>
      </div>

      <p>
        That&apos;s it. The SDK caches entitlements and auto-invalidates when
        webhooks arrive.
      </p>

      <h2>Get full entitlement details</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`const entitlement = await billing.getEntitlement(userId);
// { active: true, productId: 'prod_pro', periodEnd: Date }`}</code>
        </pre>
      </div>

      <h2>Set up webhooks</h2>
      <p>Create a webhook endpoint to auto-invalidate the cache:</p>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>app/api/webhooks/billing/route.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  const event = await billing.parseWebhook(body, signature);

  // Cache is automatically invalidated for the affected user
  console.log(event.type, event.userId);

  return new Response("ok");
}`}</code>
        </pre>
      </div>
    </article>
  );
}
