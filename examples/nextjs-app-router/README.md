# Next.js + Billing SDK Example

A complete example showing how to use `@fuime/billing-sdk` with Next.js App Router.

## Features Demonstrated

- **Entitlement caching** - Fast access checks without hitting Stripe every request
- **Feature gating** - Define what each plan can access
- **Checkout flow** - Create Stripe checkout sessions
- **Webhook handling** - Process subscription events with auto cache invalidation
- **Type-safe events** - Discriminated union events with full TypeScript support

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up Stripe

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Create two products with prices:
   - **Pro** - $20/month
   - **Enterprise** - $99/month
3. Copy the price IDs

### 3. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Stripe keys and price IDs.

### 4. Set up webhook (for local development)

Use [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/billing
```

Copy the webhook signing secret to your `.env.local`.

### 5. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── checkout/
│   │   │   └── route.ts      # POST /api/checkout - Create checkout session
│   │   └── webhooks/
│   │       └── billing/
│   │           └── route.ts  # POST /api/webhooks/billing - Handle Stripe events
│   ├── layout.tsx
│   └── page.tsx              # Main page with feature gating demo
├── lib/
│   └── billing.ts            # Billing client setup
└── .env.example
```

## Key Files

### `lib/billing.ts` - Client Setup

```typescript
import { createEnhancedClient } from "@fuime/billing-sdk";
import { stripe } from "@fuime/billing-sdk/stripe";

export const billing = createEnhancedClient({
  provider: stripe({
    apiKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  }),
  cache: { ttlMs: 60_000 },
  plans: {
    [process.env.STRIPE_PRO_PRICE_ID!]: {
      features: ["basic_export", "csv_export", "api_access"],
    },
    [process.env.STRIPE_ENTERPRISE_PRICE_ID!]: {
      features: "*", // All features
    },
  },
  defaultFeatures: ["basic_export"],
});
```

### Feature Checking

```typescript
// In any server component or API route
import { billing } from "@/lib/billing";

// Check specific feature
const hasApiAccess = await billing.hasFeature(userId, "api_access");

// Get all features
const features = await billing.getFeatures(userId);

// Get full entitlement
const entitlement = await billing.getEntitlement(userId);
```

### Webhook Handler

```typescript
// app/api/webhooks/billing/route.ts
const event = await billing.handleWebhook({
  body: rawBody,
  headers: { "stripe-signature": signature },
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
});

switch (event.type) {
  case "subscription.started":
    // New subscription
    break;
  case "subscription.canceled":
    // User still has access until event.entitlement.periodEnd
    break;
  case "subscription.ended":
    // Access revoked now
    break;
}
```

## Production Deployment

### 1. Use Redis for caching (multi-server)

```typescript
import { redisCache } from "@fuime/billing-sdk/cache/redis";
import Redis from "ioredis";

const billing = createEnhancedClient({
  provider: stripe({ ... }),
  cache: {
    adapter: redisCache({ client: new Redis(process.env.REDIS_URL!) }),
    ttlMs: 60_000,
  },
  // ...
});
```

### 2. Configure Stripe webhook endpoint

In Stripe Dashboard, add your production webhook URL:
```
https://your-app.com/api/webhooks/billing
```

Select these events:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### 3. Verify environment variables

Run the billing doctor:
```bash
npx @fuime/billing-sdk doctor
```

## License

MIT
