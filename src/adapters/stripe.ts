import Stripe from "stripe";
import type {
  BillingEvent,
  BillingProvider,
  Capabilities,
  Checkout,
  CheckoutRequest,
  Entitlement,
  EntitlementStatus,
  WebhookRequest,
} from "../types.js";
import { WebhookVerificationError } from "../types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StripeProviderOptions {
  /** Stripe secret API key (sk_...) */
  apiKey: string;
  /** Webhook signing secret (whsec_...) */
  webhookSecret: string;
  /** Optional Stripe API version override */
  apiVersion?: Stripe.LatestApiVersion;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_NAME = "stripe";

/**
 * Metadata key used to store customerRef in Stripe objects.
 * This is how we track your user ID through Stripe's system.
 */
const CUSTOMER_REF_KEY = "billing_sdk_customer_ref";

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Maps Stripe subscription status to our EntitlementStatus.
 *
 * Decisions documented:
 * - `incomplete`: Payment failed on creation. No access. → expired
 * - `incomplete_expired`: Incomplete sub expired. No access. → expired
 * - `unpaid`: All retry attempts failed. We treat as expired (no access).
 *   Rationale: unpaid means Stripe has given up on collecting. Access should stop.
 * - `paused`: Stripe Billing feature. We treat as expired (no access).
 * - `canceled`: In Stripe this means the subscription is deleted/ended. → expired
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): EntitlementStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      // Stripe's "canceled" means the subscription is gone
      return "expired";
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return "expired";
    default:
      // Future-proof: unknown statuses get no access
      return "expired";
  }
}

/**
 * Determines if user should have access based on Stripe subscription.
 */
function isSubscriptionActive(sub: Stripe.Subscription): boolean {
  const status = mapStripeStatus(sub.status);

  // Active statuses that grant access
  if (status === "active" || status === "trialing") {
    return true;
  }

  // Canceled (in our model) still has access until period end
  // This happens when cancel_at_period_end is true but sub is still "active" in Stripe
  if (sub.cancel_at_period_end && sub.status === "active") {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Entitlement building
// ---------------------------------------------------------------------------

function subscriptionToEntitlement(
  sub: Stripe.Subscription,
  customerRef: string
): Entitlement {
  // If cancel_at_period_end is set and sub is still active, our status is "canceled"
  let status: EntitlementStatus;
  if (sub.cancel_at_period_end && sub.status === "active") {
    status = "canceled";
  } else {
    status = mapStripeStatus(sub.status);
  }

  // Access period end - field name varies by API version
  const periodEndTimestamp = (sub as unknown as Record<string, unknown>).current_period_end as number | undefined;

  return {
    active: isSubscriptionActive(sub),
    status,
    productId: extractProductId(sub),
    customerRef,
    periodEnd: periodEndTimestamp
      ? new Date(periodEndTimestamp * 1000)
      : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    provider: PROVIDER_NAME,
  };
}

function extractProductId(sub: Stripe.Subscription): string {
  // Get the first item's product ID
  const item = sub.items.data[0];
  if (!item) return "";

  const price = item.price;
  if (typeof price.product === "string") {
    return price.product;
  }
  return price.product?.id ?? "";
}

function extractCustomerRef(metadata: Stripe.Metadata | null | undefined): string | null {
  return metadata?.[CUSTOMER_REF_KEY] ?? null;
}

// ---------------------------------------------------------------------------
// Webhook event handling
// ---------------------------------------------------------------------------

/**
 * Stripe events we explicitly handle.
 * All others become `unmapped`.
 */
const HANDLED_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
]);

/**
 * Stripe events we intentionally DO NOT map (they become unmapped):
 *
 * - checkout.session.completed: We don't need this; subscription.created covers it
 * - customer.created/updated/deleted: Customer lifecycle, not billing state
 * - invoice.created/finalized/sent: Invoice lifecycle before payment
 * - invoice.upcoming: Preview of next invoice
 * - payment_intent.*: Lower-level than we need
 * - charge.succeeded/failed: invoice.paid/payment_failed covers subscriptions
 * - price.*: Catalog management (out of scope)
 * - product.*: Catalog management (out of scope)
 * - coupon.*: Promotions (out of scope)
 * - customer.discount.*: Promotions (out of scope)
 * - billing_portal.*: Portal session events
 * - subscription_schedule.*: Advanced scheduling (out of scope)
 */

async function handleStripeWebhook(
  event: Stripe.Event,
  stripeClient: Stripe
): Promise<BillingEvent> {
  const eventBase = {
    id: event.id,
    provider: PROVIDER_NAME,
    occurredAt: new Date(event.created * 1000),
  };

  switch (event.type) {
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      const customerRef = extractCustomerRef(sub.metadata);

      return {
        ...eventBase,
        type: "subscription.started",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const previousAttributes = event.data.previous_attributes as Record<string, unknown> | undefined;
      const customerRef = extractCustomerRef(sub.metadata);

      // Check if this is a cancellation being scheduled
      if (
        sub.cancel_at_period_end &&
        previousAttributes &&
        !previousAttributes.cancel_at_period_end
      ) {
        // Cancellation was just scheduled
        return {
          ...eventBase,
          type: "subscription.canceled",
          customerRef,
          entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
        };
      }

      // Check if this is a renewal (period changed)
      const subAny = sub as unknown as Record<string, unknown>;
      const prevPeriodEnd = previousAttributes?.current_period_end as number | undefined;
      const currPeriodEnd = subAny.current_period_end as number | undefined;
      if (prevPeriodEnd && currPeriodEnd && currPeriodEnd > prevPeriodEnd) {
        return {
          ...eventBase,
          type: "subscription.renewed",
          customerRef,
          entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
        };
      }

      // Other updates we don't specifically model → unmapped
      return {
        ...eventBase,
        type: "unmapped",
        customerRef,
        providerType: event.type,
        raw: event.data.object,
      };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerRef = extractCustomerRef(sub.metadata);

      // This is always "ended" - access is gone now
      // Even if cancel_at_period_end was set, by the time we get deleted, the period is over
      return {
        ...eventBase,
        type: "subscription.ended",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      // Try to get customerRef from subscription metadata via the invoice
      const invoiceAny = invoice as unknown as Record<string, unknown>;
      const subDetails = invoiceAny.subscription_details as Record<string, unknown> | undefined;
      const customerRef = extractCustomerRef(subDetails?.metadata as Stripe.Metadata | undefined);

      return {
        ...eventBase,
        type: "payment.succeeded",
        customerRef,
        amount: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? "usd",
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const invoiceAny = invoice as unknown as Record<string, unknown>;
      const subDetails = invoiceAny.subscription_details as Record<string, unknown> | undefined;
      const customerRef = extractCustomerRef(subDetails?.metadata as Stripe.Metadata | undefined);

      return {
        ...eventBase,
        type: "payment.failed",
        customerRef,
        amount: invoice.amount_due ?? 0,
        currency: invoice.currency ?? "usd",
      };
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      // Try to get customerRef from charge metadata or related invoice
      const customerRef = extractCustomerRef(charge.metadata);

      return {
        ...eventBase,
        type: "refund.issued",
        customerRef,
        amount: charge.amount_refunded,
        currency: charge.currency,
      };
    }

    default: {
      // CRITICAL: Unknown events become unmapped, never dropped
      return {
        ...eventBase,
        type: "unmapped",
        customerRef: null,
        providerType: event.type,
        raw: event.data.object,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export interface StripeProvider extends BillingProvider {
  readonly native: Stripe;
}

/**
 * Creates a Stripe billing provider.
 *
 * @example
 * ```ts
 * import { stripe } from "@opencoredev/billing-sdk/stripe";
 * import { createBillingClient } from "@opencoredev/billing-sdk";
 *
 * const client = createBillingClient({
 *   provider: stripe({
 *     apiKey: process.env.STRIPE_SECRET_KEY!,
 *     webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
 *   }),
 * });
 * ```
 */
export function stripe(options: StripeProviderOptions): StripeProvider {
  const stripeClient = new Stripe(options.apiKey, {
    apiVersion: options.apiVersion,
    typescript: true,
  });

  const webhookSecret = options.webhookSecret;

  const provider: StripeProvider = {
    name: PROVIDER_NAME,

    capabilities: {
      webhookVerification: true,
      customerPortal: true,
      merchantOfRecord: false, // Stripe is not MoR - you are the merchant
      usageBilling: true, // Stripe supports it, but we don't abstract it
      proration: true, // Stripe supports it, but we don't abstract it
      refunds: true,
    } satisfies Capabilities,

    async createCheckout(req: CheckoutRequest): Promise<Checkout> {
      const session = await stripeClient.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: req.priceId,
            quantity: 1,
          },
        ],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        customer_email: req.email,
        subscription_data: {
          metadata: {
            [CUSTOMER_REF_KEY]: req.customerRef,
            ...req.metadata,
          },
        },
        metadata: {
          [CUSTOMER_REF_KEY]: req.customerRef,
          ...req.metadata,
        },
      });

      if (!session.url) {
        throw new Error("Stripe did not return a checkout URL");
      }

      return {
        id: session.id,
        url: session.url,
        provider: PROVIDER_NAME,
      };
    },

    async handleWebhook(req: WebhookRequest): Promise<BillingEvent> {
      let event: Stripe.Event;

      try {
        // CRITICAL: Use raw body string for signature verification
        event = stripeClient.webhooks.constructEvent(
          req.body,
          req.headers["stripe-signature"] ?? "",
          req.secret
        );
      } catch (err) {
        throw new WebhookVerificationError(
          err instanceof Error ? err.message : "Webhook signature verification failed"
        );
      }

      return handleStripeWebhook(event, stripeClient);
    },

    async getEntitlement(customerRef: string): Promise<Entitlement | null> {
      // Search for subscriptions with our customerRef in metadata
      const subscriptions = await stripeClient.subscriptions.search({
        query: `metadata["${CUSTOMER_REF_KEY}"]:"${customerRef}"`,
        limit: 1,
        expand: ["data.items.data.price.product"],
      });

      const sub = subscriptions.data[0];
      if (!sub) return null;

      return subscriptionToEntitlement(sub, customerRef);
    },

    async createPortalSession(
      customerRef: string,
      returnUrl: string
    ): Promise<{ url: string }> {
      // First, find the customer by searching subscriptions
      const subscriptions = await stripeClient.subscriptions.search({
        query: `metadata["${CUSTOMER_REF_KEY}"]:"${customerRef}"`,
        limit: 1,
      });

      const sub = subscriptions.data[0];
      if (!sub) {
        throw new Error(`No subscription found for customerRef: ${customerRef}`);
      }

      const customerId =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const session = await stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return { url: session.url };
    },

    async refund(paymentId: string, amount?: number): Promise<void> {
      // paymentId should be a Stripe PaymentIntent ID or Charge ID
      await stripeClient.refunds.create({
        payment_intent: paymentId.startsWith("pi_") ? paymentId : undefined,
        charge: paymentId.startsWith("ch_") ? paymentId : undefined,
        amount, // undefined = full refund
      });
    },

    get native(): Stripe {
      return stripeClient;
    },
  };

  return provider;
}
