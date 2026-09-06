export const metadata = {
  title: "Feature Gating - billing-sdk",
  description: "Define plans and check feature access with one line.",
};

export default function FeatureGating() {
  return (
    <article className="docs-article">
      <h1>Feature Gating</h1>
      <p className="docs-lead">
        Define plans and check feature access with one line.
      </p>

      <p>
        Feature gating lets you map billing products to application features,
        then check access with a simple API.
      </p>

      <h2>Define your plans</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

const billing = createEnhancedClient({
  provider: stripe({ apiKey: process.env.STRIPE_KEY }),
  plans: {
    // Stripe product IDs
    prod_free: {
      features: ["basic"],
    },
    prod_pro: {
      features: ["basic", "api", "export", "analytics"],
    },
    prod_enterprise: {
      features: "*", // All features
    },
  },
});`}</code>
        </pre>
      </div>

      <h2>Check feature access</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`// Simple boolean check
if (await billing.hasFeature(userId, "api")) {
  // User has API access
}

// Check multiple features
const features = await billing.getFeatures(userId);
// ["basic", "api", "export", "analytics"]

// Check if user has any active subscription
const entitlement = await billing.getEntitlement(userId);
if (entitlement?.active) {
  // User is subscribed
}`}</code>
        </pre>
      </div>

      <h2>Wildcard features</h2>
      <p>
        Use <code>&quot;*&quot;</code> for plans that should have access to
        everything:
      </p>
      <div className="docs-code-block">
        <pre>
          <code>{`plans: {
  prod_enterprise: {
    features: "*", // Access to all features, current and future
  },
}`}</code>
        </pre>
      </div>

      <p>When checking features:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`await billing.hasFeature(enterpriseUser, "anything"); // true
await billing.hasFeature(enterpriseUser, "new-feature"); // true`}</code>
        </pre>
      </div>

      <h2>Feature flags vs. feature gating</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Feature Flags</th>
            <th>Feature Gating</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Control rollout</td>
            <td>Control access by subscription</td>
          </tr>
          <tr>
            <td>Toggle on/off for everyone</td>
            <td>Different access per plan</td>
          </tr>
          <tr>
            <td>A/B testing</td>
            <td>Monetization</td>
          </tr>
        </tbody>
      </table>

      <p>You can combine both:</p>
      <div className="docs-code-block">
        <pre>
          <code>{`// Check feature flag AND billing
if (featureFlags.isEnabled("new-dashboard") &&
    await billing.hasFeature(userId, "dashboard")) {
  // Show new dashboard to paying users in the rollout
}`}</code>
        </pre>
      </div>

      <h2>Middleware pattern</h2>
      <p>Protect routes with middleware:</p>
      <div className="docs-code-block">
        <div className="docs-code-header">
          <span>middleware.ts</span>
        </div>
        <pre>
          <code>{`import { billing } from "@/lib/billing";
import { NextResponse } from "next/server";

export async function middleware(request: Request) {
  const userId = getUserFromSession(request);

  if (request.nextUrl.pathname.startsWith("/api/pro")) {
    if (!(await billing.hasFeature(userId, "api"))) {
      return NextResponse.json(
        { error: "Pro subscription required" },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}`}</code>
        </pre>
      </div>

      <h2>React component pattern</h2>
      <div className="docs-code-block">
        <pre>
          <code>{`async function FeatureGate({
  feature,
  userId,
  children,
  fallback
}: {
  feature: string;
  userId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const hasAccess = await billing.hasFeature(userId, feature);

  if (!hasAccess) {
    return fallback ?? null;
  }

  return <>{children}</>;
}

// Usage
<FeatureGate feature="export" userId={user.id} fallback={<UpgradePrompt />}>
  <ExportButton />
</FeatureGate>`}</code>
        </pre>
      </div>
    </article>
  );
}
