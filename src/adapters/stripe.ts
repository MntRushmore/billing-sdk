import Stripe from "stripe";
import { STRIPE_CAPABILITIES } from "./capabilities.js";
import type {
  BillingEvent,
  BillingProvider,
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
  /** Resolve from your database to avoid Stripe Search's eventual consistency. */
  resolveCustomerId?: (customerRef: string) => Promise<string | null>;
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
function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status,
): EntitlementStatus {
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
  customerRef: string,
): Entitlement {
  // If cancel_at_period_end is set and sub is still active, our status is "canceled"
  let status: EntitlementStatus;
  if (sub.cancel_at_period_end && sub.status === "active") {
    status = "canceled";
  } else {
    status = mapStripeStatus(sub.status);
  }

  // Access period end - field name varies by API version
  const periodEndTimestamp = getPeriodEnd(sub);

  return {
    active:
      isSubscriptionActive(sub) &&
      !(
        sub.cancel_at_period_end &&
        periodEndTimestamp !== undefined &&
        periodEndTimestamp * 1000 <= Date.now()
      ),
    status,
    productId: extractProductId(sub),
    customerRef,
    periodEnd:
      periodEndTimestamp !== undefined
        ? new Date(periodEndTimestamp * 1000)
        : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    provider: PROVIDER_NAME,
  };
}

function getPeriodEnd(sub: Partial<Stripe.Subscription>): number | undefined {
  const legacy = (sub as Record<string, unknown>).current_period_end;
  const item = sub.items?.data[0] as unknown as
    | Record<string, unknown>
    | undefined;
  const value = legacy ?? item?.current_period_end;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function customerQuery(ref: string): string {
  const escaped = ref.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `metadata["${CUSTOMER_REF_KEY}"]:"${escaped}"`;
}

function invoiceCustomerRef(invoice: Stripe.Invoice): string | null {
  const data = invoice as unknown as {
    subscription_details?: { metadata?: Stripe.Metadata };
    parent?: { subscription_details?: { metadata?: Stripe.Metadata } };
  };
  return (
    extractCustomerRef(
      data.parent?.subscription_details?.metadata ??
        data.subscription_details?.metadata,
    ) ?? extractCustomerRef(invoice.metadata)
  );
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

function extractCustomerRef(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  return metadata?.[CUSTOMER_REF_KEY] ?? null;
}

// ---------------------------------------------------------------------------
// Webhook event handling
// ---------------------------------------------------------------------------

/**
 * Stripe events we explicitly handle.
 * All others become `unmapped`.
 */
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

async function handleStripeWebhook(event: Stripe.Event): Promise<BillingEvent> {
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
      const previousAttributes = event.data.previous_attributes as
        | Record<string, unknown>
        | undefined;
      const customerRef = extractCustomerRef(sub.metadata);

      // Check if this is a cancellation being scheduled
      if (
        sub.cancel_at_period_end &&
        previousAttributes &&
        previousAttributes.cancel_at_period_end === false
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
      const prevPeriodEnd = previousAttributes
        ? getPeriodEnd(previousAttributes as Partial<Stripe.Subscription>)
        : undefined;
      const currPeriodEnd = getPeriodEnd(sub);
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
      const customerRef = invoiceCustomerRef(invoice);

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
      const customerRef = invoiceCustomerRef(invoice);

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
        customerRef: extractCustomerRef(
          (event.data.object as { metadata?: Stripe.Metadata }).metadata,
        ),
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
 * import { stripe } from "@fuime/billing-sdk/stripe";
 * import { createBillingClient } from "@fuime/billing-sdk";
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

  async function findSubscription(
    customerRef: string,
  ): Promise<Stripe.Subscription | null> {
    const candidates: Stripe.Subscription[] = [];
    if (options.resolveCustomerId) {
      const customer = await options.resolveCustomerId(customerRef);
      if (!customer) return null;
      let after: string | undefined;
      while (true) {
        const page = await stripeClient.subscriptions.list({
          customer,
          status: "all",
          limit: 100,
          starting_after: after,
        });
        candidates.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        after = page.data[page.data.length - 1]!.id;
      }
    } else {
      let nextPage: string | undefined;
      do {
        const page = await stripeClient.subscriptions.search({
          query: customerQuery(customerRef),
          limit: 100,
          page: nextPage,
        });
        candidates.push(
          ...page.data.filter(
            (sub) => extractCustomerRef(sub.metadata) === customerRef,
          ),
        );
        nextPage = page.has_more ? (page.next_page ?? undefined) : undefined;
      } while (nextPage);
    }
    // The singular entitlement API selects an accessible subscription first,
    // then the newest creation. It does not union multiple plans or add-ons.
    candidates.sort(
      (a, b) =>
        Number(subscriptionToEntitlement(b, customerRef).active) -
          Number(subscriptionToEntitlement(a, customerRef).active) ||
        b.created - a.created ||
        a.id.localeCompare(b.id),
    );
    return candidates[0] ?? null;
  }

  const provider: StripeProvider = {
    name: PROVIDER_NAME,

    capabilities: { ...STRIPE_CAPABILITIES },

    async createCheckout(req: CheckoutRequest): Promise<Checkout> {
      const customer = await options.resolveCustomerId?.(req.customerRef);
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
        customer: customer ?? undefined,
        customer_email: customer ? undefined : req.email,
        subscription_data: {
          metadata: {
            ...req.metadata,
            [CUSTOMER_REF_KEY]: req.customerRef,
          },
        },
        metadata: {
          ...req.metadata,
          [CUSTOMER_REF_KEY]: req.customerRef,
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
          Object.entries(req.headers).find(
            ([name]) => name.toLowerCase() === "stripe-signature",
          )?.[1] ?? "",
          req.secret,
        );
      } catch (err) {
        throw new WebhookVerificationError(
          err instanceof Error
            ? err.message
            : "Webhook signature verification failed",
        );
      }

      return handleStripeWebhook(event);
    },

    async getEntitlement(customerRef: string): Promise<Entitlement | null> {
      const sub = await findSubscription(customerRef);
      if (!sub) return null;

      return subscriptionToEntitlement(sub, customerRef);
    },

    async createPortalSession(
      customerRef: string,
      returnUrl: string,
    ): Promise<{ url: string }> {
      const resolved = await options.resolveCustomerId?.(customerRef);
      const sub = resolved ? null : await findSubscription(customerRef);
      const customerId =
        resolved ??
        (typeof sub?.customer === "string" ? sub.customer : sub?.customer.id);
      if (!customerId)
        throw new Error(`No customer found for customerRef: ${customerRef}`);

      const session = await stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return { url: session.url };
    },

    async refund(paymentId: string, amount?: number): Promise<void> {
      if (!/^(pi_|ch_).+/.test(paymentId))
        throw new TypeError("Expected a Stripe PaymentIntent or Charge ID");
      if (
        amount !== undefined &&
        (!Number.isSafeInteger(amount) || amount <= 0)
      )
        throw new RangeError(
          "Refund amount must be a positive integer in minor units",
        );
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
