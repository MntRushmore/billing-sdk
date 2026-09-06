import { billing, FEATURES } from "@/lib/billing";

// Demo user ID - in real app, get from auth
const DEMO_USER_ID = "demo_user_123";

export default async function Home() {
  // Check user's entitlement (uses cache)
  const entitlement = await billing.getEntitlement(DEMO_USER_ID);

  // Get features available to this user
  const features = await billing.getFeatures(DEMO_USER_ID);

  // Check specific features
  const hasApiAccess = await billing.hasFeature(DEMO_USER_ID, FEATURES.API_ACCESS);
  const hasCsvExport = await billing.hasFeature(DEMO_USER_ID, FEATURES.CSV_EXPORT);

  return (
    <div>
      {/* Current Status */}
      <section style={{ marginBottom: "2rem", padding: "1rem", background: "#f5f5f5", borderRadius: "8px" }}>
        <h2>Current Status</h2>
        {entitlement ? (
          <div>
            <p><strong>Status:</strong> {entitlement.status}</p>
            <p><strong>Active:</strong> {entitlement.active ? "Yes" : "No"}</p>
            <p><strong>Product:</strong> {entitlement.productId}</p>
            {entitlement.periodEnd && (
              <p><strong>Period ends:</strong> {entitlement.periodEnd.toLocaleDateString()}</p>
            )}
            {entitlement.cancelAtPeriodEnd && (
              <p style={{ color: "orange" }}>Subscription will cancel at period end</p>
            )}
          </div>
        ) : (
          <p>No active subscription - using free tier</p>
        )}
      </section>

      {/* Feature Access */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Feature Access</h2>
        <p>Features available to you: <strong>{features.join(", ") || "None"}</strong></p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem" }}>
          <FeatureCard
            name="Basic Export"
            available={features.includes(FEATURES.BASIC_EXPORT)}
            description="Export data as JSON"
          />
          <FeatureCard
            name="CSV Export"
            available={hasCsvExport}
            description="Export data as CSV"
          />
          <FeatureCard
            name="API Access"
            available={hasApiAccess}
            description="Programmatic API access"
          />
          <FeatureCard
            name="Priority Support"
            available={features.includes(FEATURES.PRIORITY_SUPPORT)}
            description="24/7 priority support"
          />
        </div>
      </section>

      {/* Pricing */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Upgrade Your Plan</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <PricingCard
            name="Free"
            price="$0"
            features={["Basic Export"]}
            current={!entitlement?.active}
          />
          <PricingCard
            name="Pro"
            price="$20/mo"
            features={["Basic Export", "CSV Export", "API Access", "Priority Support"]}
            priceId={process.env.STRIPE_PRO_PRICE_ID}
            userId={DEMO_USER_ID}
            current={entitlement?.productId === process.env.STRIPE_PRO_PRICE_ID}
          />
          <PricingCard
            name="Enterprise"
            price="$99/mo"
            features={["Everything in Pro", "SSO", "Custom Branding", "Dedicated Support"]}
            priceId={process.env.STRIPE_ENTERPRISE_PRICE_ID}
            userId={DEMO_USER_ID}
            current={entitlement?.productId === process.env.STRIPE_ENTERPRISE_PRICE_ID}
          />
        </div>
      </section>

      {/* Code Example */}
      <section>
        <h2>Code Example</h2>
        <pre style={{ background: "#1e1e1e", color: "#d4d4d4", padding: "1rem", borderRadius: "8px", overflow: "auto" }}>
{`// Check if user has access to a feature
const hasApiAccess = await billing.hasFeature(userId, "api_access");

if (hasApiAccess) {
  // Allow API usage
} else {
  // Show upgrade prompt
}

// Get all features for a user
const features = await billing.getFeatures(userId);
// ["basic_export", "csv_export", "api_access", "priority_support"]

// Check entitlement details
const entitlement = await billing.getEntitlement(userId);
if (entitlement?.active) {
  console.log("User has access until:", entitlement.periodEnd);
}`}
        </pre>
      </section>
    </div>
  );
}

function FeatureCard({ name, available, description }: { name: string; available: boolean; description: string }) {
  return (
    <div style={{
      padding: "1rem",
      border: "1px solid #ddd",
      borderRadius: "8px",
      background: available ? "#e8f5e9" : "#fff",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1.2rem" }}>{available ? "✓" : "✗"}</span>
        <strong>{name}</strong>
      </div>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", color: "#666" }}>{description}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  features,
  priceId,
  userId,
  current,
}: {
  name: string;
  price: string;
  features: string[];
  priceId?: string;
  userId?: string;
  current?: boolean;
}) {
  return (
    <div style={{
      padding: "1.5rem",
      border: current ? "2px solid #1976d2" : "1px solid #ddd",
      borderRadius: "8px",
      minWidth: "200px",
      background: current ? "#e3f2fd" : "#fff",
    }}>
      <h3 style={{ margin: "0 0 0.5rem" }}>{name}</h3>
      <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0 0 1rem" }}>{price}</p>
      <ul style={{ margin: "0 0 1rem", paddingLeft: "1.2rem" }}>
        {features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {current ? (
        <button disabled style={{ width: "100%", padding: "0.5rem", background: "#ccc", border: "none", borderRadius: "4px" }}>
          Current Plan
        </button>
      ) : priceId ? (
        <form action="/api/checkout" method="POST">
          <input type="hidden" name="priceId" value={priceId} />
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.5rem",
              background: "#1976d2",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Upgrade
          </button>
        </form>
      ) : null}
    </div>
  );
}
