import { Polar } from "@polar-sh/sdk";
import {
  validateEvent,
  WebhookVerificationError as PolarWebhookError,
} from "@polar-sh/sdk/webhooks";
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

export interface PolarProviderOptions {
  /** Polar access token */
  accessToken: string;
  /** Webhook signing secret */
  webhookSecret: string;
  /** Use sandbox environment. Default: false (production) */
  sandbox?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_NAME = "polar";

/**
 * Metadata key used to store customerRef in Polar checkout metadata.
 */
const CUSTOMER_REF_KEY = "billing_sdk_customer_ref";

// ---------------------------------------------------------------------------
// Types from Polar SDK
// ---------------------------------------------------------------------------

// Polar subscription status types
type PolarSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

// Polar webhook event types we care about
interface PolarWebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

interface PolarSubscription {
  id: string;
  status: PolarSubscriptionStatus;
  cancel_at_period_end: boolean;
  current_period_start: string;
  current_period_end: string;
  product_id: string;
  customer_id: string;
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Maps Polar subscription status to our EntitlementStatus.
 *
 * Polar statuses are similar to Stripe's since they follow similar patterns.
 */
function mapPolarStatus(polarStatus: PolarSubscriptionStatus): EntitlementStatus {
  switch (polarStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      // In Polar, canceled means the subscription is terminated
      return "expired";
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
      return "expired";
    default:
      return "expired";
  }
}

/**
 * Determines if user should have access based on Polar subscription.
 */
function isSubscriptionActive(sub: PolarSubscription): boolean {
  const status = mapPolarStatus(sub.status);

  if (status === "active" || status === "trialing") {
    return true;
  }

  // Canceled with cancel_at_period_end means still has access until period end
  if (sub.cancel_at_period_end && sub.status === "active") {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Entitlement building
// ---------------------------------------------------------------------------

function subscriptionToEntitlement(
  sub: PolarSubscription,
  customerRef: string
): Entitlement {
  let status: EntitlementStatus;
  if (sub.cancel_at_period_end && sub.status === "active") {
    status = "canceled";
  } else {
    status = mapPolarStatus(sub.status);
  }

  return {
    active: isSubscriptionActive(sub),
    status,
    productId: sub.product_id,
    customerRef,
    periodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    provider: PROVIDER_NAME,
  };
}

function extractCustomerRef(metadata: Record<string, string> | null | undefined): string | null {
  return metadata?.[CUSTOMER_REF_KEY] ?? null;
}

// ---------------------------------------------------------------------------
// Webhook event handling
// ---------------------------------------------------------------------------

/**
 * Polar events we explicitly handle.
 * All others become `unmapped`.
 *
 * Polar subscription events:
 * - subscription.created → subscription.started
 * - subscription.cycled → subscription.renewed (new billing period)
 * - subscription.canceled → subscription.canceled (scheduled)
 * - subscription.revoked → subscription.ended (access gone)
 * - subscription.active → unmapped (status change, not meaningful alone)
 * - subscription.updated → unmapped (catch-all)
 * - subscription.uncanceled → unmapped (reversal, not modeled)
 * - subscription.past_due → unmapped (payment failed, see payment events)
 * - subscription.paused → unmapped (not modeled in v1)
 * - subscription.resumed → unmapped (not modeled in v1)
 *
 * Order/Payment events:
 * - order.paid → payment.succeeded
 * - order.refunded → refund.issued
 */

async function handlePolarWebhook(event: PolarWebhookEvent): Promise<BillingEvent> {
  const eventId = `polar_evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const occurredAt = new Date();

  const eventBase = {
    id: eventId,
    provider: PROVIDER_NAME,
    occurredAt,
  };

  switch (event.type) {
    case "subscription.created": {
      const sub = event.data as unknown as PolarSubscription;
      const customerRef = extractCustomerRef(sub.metadata);

      return {
        ...eventBase,
        type: "subscription.started",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "subscription.cycled": {
      const sub = event.data as unknown as PolarSubscription;
      const customerRef = extractCustomerRef(sub.metadata);

      return {
        ...eventBase,
        type: "subscription.renewed",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "subscription.canceled": {
      const sub = event.data as unknown as PolarSubscription;
      const customerRef = extractCustomerRef(sub.metadata);

      // In Polar, subscription.canceled means cancellation was initiated
      // If cancel_at_period_end is true, access continues until period end
      return {
        ...eventBase,
        type: "subscription.canceled",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "subscription.revoked": {
      const sub = event.data as unknown as PolarSubscription;
      const customerRef = extractCustomerRef(sub.metadata);

      // Revoked means access is immediately terminated
      return {
        ...eventBase,
        type: "subscription.ended",
        customerRef,
        entitlement: subscriptionToEntitlement(sub, customerRef ?? ""),
      };
    }

    case "order.paid": {
      const order = event.data as Record<string, unknown>;
      const subscription = order.subscription as PolarSubscription | undefined;
      const customerRef = subscription
        ? extractCustomerRef(subscription.metadata)
        : null;

      return {
        ...eventBase,
        type: "payment.succeeded",
        customerRef,
        amount: (order.amount as number) ?? 0,
        currency: (order.currency as string) ?? "usd",
      };
    }

    case "order.refunded": {
      const order = event.data as Record<string, unknown>;
      const subscription = order.subscription as PolarSubscription | undefined;
      const customerRef = subscription
        ? extractCustomerRef(subscription.metadata)
        : null;

      return {
        ...eventBase,
        type: "refund.issued",
        customerRef,
        amount: (order.amount as number) ?? 0,
        currency: (order.currency as string) ?? "usd",
      };
    }

    default: {
      // CRITICAL: Unknown events become unmapped, never dropped
      // This includes: subscription.active, subscription.updated,
      // subscription.uncanceled, subscription.past_due, subscription.paused,
      // subscription.resumed, and any future event types
      return {
        ...eventBase,
        type: "unmapped",
        customerRef: null,
        providerType: event.type,
        raw: event.data,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export interface PolarProvider extends BillingProvider {
  readonly native: Polar;
}

/**
 * Creates a Polar billing provider.
 *
 * Polar is a Merchant of Record (MoR) — they handle tax collection
 * and remittance. This is reflected in capabilities.merchantOfRecord = true.
 *
 * @example
 * ```ts
 * import { polar } from "@fuime/billing-sdk/polar";
 * import { createBillingClient } from "@fuime/billing-sdk";
 *
 * const client = createBillingClient({
 *   provider: polar({
 *     accessToken: process.env.POLAR_ACCESS_TOKEN!,
 *     webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
 *   }),
 * });
 *
 * // Check capability difference
 * if (client.capabilities.merchantOfRecord) {
 *   console.log("Polar handles tax - you are not the merchant");
 * }
 * ```
 */
export function polar(options: PolarProviderOptions): PolarProvider {
  const polarClient = new Polar({
    accessToken: options.accessToken,
    server: options.sandbox ? "sandbox" : "production",
  });

  const webhookSecret = options.webhookSecret;

  const provider: PolarProvider = {
    name: PROVIDER_NAME,

    capabilities: {
      webhookVerification: true,
      customerPortal: true,
      merchantOfRecord: true, // Polar IS the merchant - handles tax
      usageBilling: false, // Not supported in Polar
      proration: false, // Not abstracted
      refunds: true,
    } satisfies Capabilities,

    async createCheckout(req: CheckoutRequest): Promise<Checkout> {
      // Polar uses products array (product IDs)
      // priceId from our interface maps to Polar's product ID
      const session = await polarClient.checkouts.create({
        products: [req.priceId],
        successUrl: req.successUrl,
        customerEmail: req.email,
        metadata: {
          [CUSTOMER_REF_KEY]: req.customerRef,
          ...req.metadata,
        },
      });

      return {
        id: session.id,
        url: session.url,
        provider: PROVIDER_NAME,
      };
    },

    async handleWebhook(req: WebhookRequest): Promise<BillingEvent> {
      let event: PolarWebhookEvent;

      try {
        // Polar uses Standard Webhooks format
        // Headers should include webhook-id, webhook-timestamp, webhook-signature
        event = validateEvent(req.body, req.headers, req.secret) as PolarWebhookEvent;
      } catch (err) {
        if (err instanceof PolarWebhookError) {
          throw new WebhookVerificationError(err.message);
        }
        throw new WebhookVerificationError(
          err instanceof Error ? err.message : "Webhook signature verification failed"
        );
      }

      return handlePolarWebhook(event);
    },

    async getEntitlement(customerRef: string): Promise<Entitlement | null> {
      // Polar doesn't have a direct "search by metadata" API like Stripe
      // We need to list subscriptions and filter
      // This is a limitation - in production you'd want to store the mapping
      try {
        const subscriptions = await polarClient.subscriptions.list({
          limit: 100,
        });

        // Find subscription with matching customerRef in metadata
        for (const sub of subscriptions.result.items) {
          const subData = sub as unknown as PolarSubscription;
          if (subData.metadata?.[CUSTOMER_REF_KEY] === customerRef) {
            return subscriptionToEntitlement(subData, customerRef);
          }
        }

        return null;
      } catch {
        return null;
      }
    },

    async createPortalSession(
      customerRef: string,
      returnUrl: string
    ): Promise<{ url: string }> {
      // Find the customer's subscription first
      const subscriptions = await polarClient.subscriptions.list({
        limit: 100,
      });

      let customerId: string | null = null;
      for (const sub of subscriptions.result.items) {
        const subData = sub as unknown as PolarSubscription;
        if (subData.metadata?.[CUSTOMER_REF_KEY] === customerRef) {
          customerId = subData.customer_id;
          break;
        }
      }

      if (!customerId) {
        throw new Error(`No subscription found for customerRef: ${customerRef}`);
      }

      // Polar's customer portal is accessed differently
      // For now, we construct a portal URL
      // Note: This may need adjustment based on Polar's actual portal API
      const session = await polarClient.customerSessions.create({
        customerId,
      });

      return {
        url: session.customerPortalUrl,
      };
    },

    async refund(paymentId: string, amount?: number): Promise<void> {
      // Polar refunds are created through the refunds API
      // paymentId should be an order ID
      // If amount is not specified, we need to look up the order amount
      // For now, require amount to be specified
      if (amount === undefined) {
        throw new Error("Polar refunds require an amount. Use native() to access full API.");
      }
      await polarClient.refunds.create({
        orderId: paymentId,
        reason: "customer_request",
        amount,
      });
    },

    get native(): Polar {
      return polarClient;
    },
  };

  return provider;
}
