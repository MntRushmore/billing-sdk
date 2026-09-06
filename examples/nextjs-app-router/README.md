# Next.js App Router example

This example demonstrates product-based feature gates, authenticated checkout, HTML form and JSON requests, and verified billing webhooks. It builds without payment credentials; signed-out visitors see the free view.

## Setup

1. From the repository root, run `pnpm install --frozen-lockfile` and `pnpm build`.
2. In this directory, copy `.env.example` to `.env.local`.
3. Add Stripe test keys and create Pro and Enterprise products/prices. Copy **both** the `prod_` IDs and `price_` IDs. Plan definitions use products; checkout uses prices.
4. Implement `getCurrentUserId` in `lib/billing.ts` using your authentication provider's **server-verified session**. It intentionally returns null until connected. Do not take identity from the request body or an unsigned cookie.
5. Set `NEXT_PUBLIC_APP_URL` to the actual app origin. The checkout handler checks `Origin` before creating a session.
6. Run `pnpm dev` and open http://localhost:3000.

Forward test webhooks with:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/billing
```

Put the resulting signing secret in `.env.local`. Enable subscription created/updated/deleted, invoice paid/payment-failed, and charge refunded events in the deployed endpoint.

## Routes

| Route                        | Behavior                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `/`                          | Current subscription, feature access, and pricing forms                              |
| `POST /api/checkout`         | Server-authenticated user plus allowlisted price; JSON response or 303 form redirect |
| `POST /api/webhooks/billing` | Raw-body verification, normalized events, and cache invalidation                     |
| `/billing/success`           | Confirmation page; redirects alone never grant access                                |
| `/billing/cancel`            | Return to pricing                                                                    |

JSON checkout requests have `{ "priceId": "price_..." }`. The server ignores client-supplied user IDs. A signed-out request returns 401; malformed/unknown prices return 400; a different origin returns 403.

## Production integration

- Store Stripe customer IDs and configure `resolveCustomerId` to avoid Search's eventual consistency.
- Use a shared Redis cache with an application/environment/account-specific prefix if running multiple servers. See the root README for consistency limits and a node-redis bridge.
- Persist webhook `(provider, event.id)` atomically with business changes before non-idempotent side effects. Return success only after processing; use a durable queue for longer work.
- Protect actual data/export/API routes with server-side access checks. Hiding a pricing button or feature card is not authorization.
- Store and update quota usage in your database transaction; `checkLimit` does not reserve capacity.
- Verify checkout, failed payments, cancellation, portal access, and refunds in Stripe test mode before accepting payments.

## Validation

From the repository root:

```bash
pnpm check
pnpm --filter billing-sdk-nextjs-example exec tsc --noEmit
pnpm --filter billing-sdk-nextjs-example build
```

The auth hook is deliberately left for the integrating application; this example does not ship its own login system or persistence layer.
