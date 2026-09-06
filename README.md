# @fuime/billing-sdk

Typed billing interface across payment providers. Answers the question: **"can this user access the thing right now?"**

This SDK models subscription state and entitlements—not checkout wrappers. It provides a unified interface to query whether a user has access, handle webhooks, and manage the subscription lifecycle.

## Installation

```bash
pnpm add @fuime/billing-sdk
```

For specific providers, also install their SDKs:

```bash
# For Stripe
pnpm add stripe

# For Polar (SDK included)
# Nothing extra needed
```

## Quick Start

```typescript
import { createBillingClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

const billing = createBillingClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),
});

// Check if user has access
const entitlement = await billing.getEntitlement("user_123");
if (entitlement?.active) {
  // User has access
}
```

## Enhanced Client (Cache + Feature Gating)

For most apps, use `createEnhancedClient` instead of `createBillingClient`. It adds:
- **Entitlement caching** - Don't hit Stripe on every request
- **Feature gating** - Define what each plan can access

```typescript
import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),

  // Cache entitlements for 1 minute
  cache: { ttlMs: 60_000 },

  // Define features per plan
  plans: {
    "prod_free": { features: ["basic_export"] },
    "prod_pro": { features: ["basic_export", "api_access", "priority_support"] },
    "prod_enterprise": { features: "*" }, // All features
  },

  // Features available without subscription
  defaultFeatures: ["basic_export"],
});

// Fast - uses cache
const entitlement = await billing.getEntitlement("user_123");

// Simple feature checks
if (await billing.hasFeature("user_123", "api_access")) {
  // Allow API usage
}

// Get all features for a user
const features = await billing.getFeatures("user_123");
// ["basic_export", "api_access", "priority_support"]
```

### Caching

The cache automatically invalidates when webhooks indicate state changes:

```typescript
// Webhook handler auto-invalidates cache
app.post("/webhook", async (req, res) => {
  const event = await billing.handleWebhook(req);
  // Cache for event.customerRef is now invalidated
  // Next getEntitlement() call fetches fresh data
});
```

Use Redis for multi-server deployments:

```typescript
import { redisCache } from "@fuime/billing-sdk/cache/redis";
import Redis from "ioredis";

const billing = createEnhancedClient({
  provider: stripe({ ... }),
  cache: {
    adapter: redisCache({ client: new Redis(process.env.REDIS_URL) }),
    ttlMs: 60_000,
  },
});
```

### Feature Gating

Define features per plan, check access simply:

```typescript
// Detailed check with reason
const result = await billing.checkFeature("user_123", "api_access");
// { allowed: true, reason: "plan_feature", productId: "prod_pro" }

// Possible reasons:
// - "plan_feature" - Feature is in their plan
// - "default" - Using default features (no/inactive subscription)
// - "no_subscription" - No subscription and not a default feature
// - "unknown_plan" - Active subscription but plan not in config
// - "feature_not_in_plan" - Active subscription but feature not included
```

Wildcard plans grant all defined features:

```typescript
plans: {
  "prod_enterprise": { features: "*" }, // Gets everything
}
```

## Capability Matrix

Not all providers support all features. Check `capabilities` to know what's available:

| Capability             | Mock | Stripe | Polar |
| ---------------------- | ---- | ------ | ----- |
| webhookVerification    | Yes  | Yes    | Yes   |
| customerPortal         | Yes  | Yes    | Yes   |
| merchantOfRecord       | No   | No     | Yes   |
| usageBilling           | Yes  | Yes    | No    |
| proration              | No   | No     | No    |
| refunds                | Yes  | Yes    | Yes   |

**Key distinction**: Polar is a Merchant of Record (MoR)—they handle tax collection and remittance. Stripe is not—you are the merchant and must handle tax yourself.

```typescript
if (billing.capabilities.merchantOfRecord) {
  // Provider handles tax (Polar)
} else {
  // You handle tax (Stripe)
}
```

## Providers

### Stripe

```typescript
import { stripe } from "@fuime/billing-sdk/stripe";

const provider = stripe({
  apiKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});
```

### Polar

```typescript
import { polar } from "@fuime/billing-sdk/polar";

const provider = polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  sandbox: true, // Optional: use sandbox environment
});
```

### Mock (for testing)

```typescript
import { mock } from "@fuime/billing-sdk/mock";

const provider = mock({
  webhookSecret: "test_secret",
});

// Testing utilities
provider._testing.createSubscription({
  customerRef: "user_123",
  productId: "prod_premium",
  status: "active",
});
```

## Core Concepts

### Entitlements

An `Entitlement` represents whether a user has access and why:

```typescript
interface Entitlement {
  active: boolean;           // Can they access the thing RIGHT NOW?
  status: EntitlementStatus; // trialing | active | canceled | past_due | expired
  productId: string;
  customerRef: string;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  provider: string;
}
```

The `active` field is derived from `status`:
- `active` or `trialing` = `active: true`
- `canceled` with time remaining = `active: true` (access until period end)
- `past_due` or `expired` = `active: false`

### Billing Events

Webhooks are parsed into typed events:

```typescript
type BillingEvent =
  | { type: "subscription.started"; entitlement: Entitlement }
  | { type: "subscription.renewed"; entitlement: Entitlement }
  | { type: "subscription.canceled"; entitlement: Entitlement }
  | { type: "subscription.ended"; entitlement: Entitlement }
  | { type: "payment.succeeded"; amount: number; currency: string }
  | { type: "payment.failed"; amount: number; currency: string }
  | { type: "refund.issued"; amount: number; currency: string }
  | { type: "unmapped"; providerType: string; raw: unknown };
```

**Critical**: Unknown events become `unmapped`, never silently dropped.

### canceled vs ended

This distinction is essential:

- **`subscription.canceled`**: User initiated cancellation, but **still has access** until `periodEnd`
- **`subscription.ended`**: Access is **immediately terminated**

```typescript
const event = await billing.handleWebhook(req);

if (event.type === "subscription.canceled") {
  // User canceled, but entitlement.active might still be true
  // Access continues until periodEnd
  console.log("Access until:", event.entitlement.periodEnd);
}

if (event.type === "subscription.ended") {
  // Access is gone NOW
  // entitlement.active is false
}
```

## Webhook Handling

```typescript
// Express/Node.js
app.post("/webhooks/billing", async (req, res) => {
  const event = await billing.handleWebhook({
    body: req.body, // Raw body string (before JSON.parse)
    headers: req.headers,
    secret: process.env.WEBHOOK_SECRET!,
  });

  switch (event.type) {
    case "subscription.started":
      await db.users.update(event.customerRef, { plan: "premium" });
      break;
    case "subscription.ended":
      await db.users.update(event.customerRef, { plan: "free" });
      break;
    case "unmapped":
      console.log("Unhandled event:", event.providerType);
      break;
  }

  res.sendStatus(200);
});
```

## Creating Checkouts

```typescript
const checkout = await billing.createCheckout({
  customerRef: "user_123",     // Your user ID
  priceId: "price_premium",    // Provider's price/product ID
  successUrl: "https://...",
  cancelUrl: "https://...",
  email: "user@example.com",   // Optional
});

// Redirect user to checkout.url
```

The `customerRef` is stored in the subscription metadata and returned in webhook events.

## Customer Portal

```typescript
const session = await billing.createPortalSession(
  "user_123",
  "https://example.com/account"
);

// Redirect user to session.url
```

## Native SDK Access

For provider-specific features not in the unified interface:

```typescript
import Stripe from "stripe";

// Type-safe native access
const stripeClient = billing.native<Stripe>();

// Use any Stripe API
const invoice = await stripeClient.invoices.retrieve("inv_...");
```

## CLI Doctor

Check your provider configuration:

```bash
npx @fuime/billing-sdk doctor
```

Output:
```
billing-sdk doctor

Checking provider health...

✓ STRIPE
  Credentials valid, API reachable
  Mode: test
  Enabled: webhookVerification, customerPortal, usageBilling, refunds
  Disabled: merchantOfRecord, proration

✓ POLAR
  Credentials valid, API reachable
  Mode: sandbox
  Enabled: webhookVerification, customerPortal, merchantOfRecord, refunds
  Disabled: usageBilling, proration

Capability Matrix:
────────────────────────────────────────────────────────────────
Capability                stripe     polar
────────────────────────────────────────────────────────────────
webhookVerification       ✓          ✓
customerPortal            ✓          ✓
merchantOfRecord          –          ✓
usageBilling              ✓          –
proration                 –          –
refunds                   ✓          ✓

All checks passed!
```

## Conformance Testing

Test your adapter against the standard contract:

```typescript
import { describe } from "vitest";
import { runConformanceSuite } from "@fuime/billing-sdk/conformance";
import { createMockHarness } from "@fuime/billing-sdk/conformance/mock-harness";

describe("my adapter", () => {
  runConformanceSuite(myProvider, createMockHarness(myProvider));
});
```

## Design Principles

1. **Never silently drop events** - Unknown webhook events become `unmapped`, not ignored
2. **canceled ≠ ended** - These are distinct states with different access implications
3. **Capabilities are truthful** - If a provider can't do something, `capabilities` reflects that
4. **No provider logic leaks** - All provider-specific code stays in adapters
5. **Type safety** - Full TypeScript support with discriminated unions

## Out of Scope (v1)

- Proration calculations
- Usage-based billing metering
- Tax configuration
- Product/price catalog management

These require too much provider-specific logic to abstract cleanly.

## License

MIT
