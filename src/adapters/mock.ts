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
// Mock state types
// ---------------------------------------------------------------------------

export interface MockSubscription {
  id: string;
  customerRef: string;
  priceId: string;
  productId: string;
  status: EntitlementStatus;
  periodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
}

export interface MockPayment {
  id: string;
  customerRef: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  createdAt: Date;
}

export interface MockState {
  subscriptions: Map<string, MockSubscription>;
  payments: Map<string, MockPayment>;
  /** Maps customerRef -> subscriptionId for quick lookup */
  customerSubscriptions: Map<string, string>;
  /** Pending checkouts waiting to be completed */
  pendingCheckouts: Map<string, CheckoutRequest>;
}

export interface MockWebhookPayload {
  type: string;
  subscriptionId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Mock adapter configuration
// ---------------------------------------------------------------------------

export interface MockProviderOptions {
  /** Webhook signing secret. Default: "mock_webhook_secret" */
  webhookSecret?: string;
  /** Base URL for checkout. Default: "https://mock.billing.test" */
  baseUrl?: string;
  /** Initial state to seed the mock with */
  initialState?: Partial<MockState>;
}

// ---------------------------------------------------------------------------
// Mock adapter implementation
// ---------------------------------------------------------------------------

const MOCK_PROVIDER_NAME = "mock";

function createMockState(initial?: Partial<MockState>): MockState {
  return {
    subscriptions: new Map(initial?.subscriptions),
    payments: new Map(initial?.payments),
    customerSubscriptions: new Map(initial?.customerSubscriptions),
    pendingCheckouts: new Map(initial?.pendingCheckouts),
  };
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Computes HMAC-SHA256 signature for webhook verification.
 * Uses Web Crypto API for Node.js 20+ compatibility.
 */
async function computeSignature(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function subscriptionToEntitlement(
  sub: MockSubscription
): Entitlement {
  const now = new Date();
  const isPastPeriodEnd = sub.periodEnd < now;

  // Derive `active` from status and period
  // active = true when user should have access
  const active =
    (sub.status === "active" ||
      sub.status === "trialing" ||
      sub.status === "canceled") && // canceled still has access until periodEnd
    !isPastPeriodEnd;

  return {
    active,
    status: sub.status,
    productId: sub.productId,
    customerRef: sub.customerRef,
    periodEnd: sub.periodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    provider: MOCK_PROVIDER_NAME,
  };
}

/**
 * Creates a mock billing provider for testing.
 *
 * The mock is fully in-memory and supports the complete BillingProvider interface.
 * Use the returned `_testing` object to drive state changes and simulate webhooks.
 */
export function mock(options: MockProviderOptions = {}): MockProvider {
  const webhookSecret = options.webhookSecret ?? "mock_webhook_secret";
  const baseUrl = options.baseUrl ?? "https://mock.billing.test";
  const state = createMockState(options.initialState);

  const provider: MockProvider = {
    name: MOCK_PROVIDER_NAME,

    capabilities: {
      webhookVerification: true,
      customerPortal: true,
      merchantOfRecord: false, // Mock simulates a non-MoR provider like Stripe
      usageBilling: false,
      proration: false,
      refunds: true,
    } satisfies Capabilities,

    async createCheckout(req: CheckoutRequest): Promise<Checkout> {
      const id = generateId("checkout");
      state.pendingCheckouts.set(id, req);

      return {
        id,
        url: `${baseUrl}/checkout/${id}`,
        provider: MOCK_PROVIDER_NAME,
      };
    },

    async handleWebhook(req: WebhookRequest): Promise<BillingEvent> {
      // Verify signature before parsing
      const providedSignature = req.headers["x-mock-signature"];
      if (!providedSignature) {
        throw new WebhookVerificationError("Missing signature header");
      }

      const expectedSignature = await computeSignature(req.body, req.secret);
      if (!timingSafeEqual(providedSignature, expectedSignature)) {
        throw new WebhookVerificationError();
      }

      // Safe to parse after verification
      const payload = JSON.parse(req.body) as MockWebhookPayload;
      const eventId = generateId("evt");
      const occurredAt = new Date();

      // Route to appropriate handler based on event type
      switch (payload.type) {
        case "subscription.created": {
          const sub = state.subscriptions.get(payload.subscriptionId!);
          if (!sub) {
            throw new Error(`Subscription not found: ${payload.subscriptionId}`);
          }
          return {
            id: eventId,
            type: "subscription.started",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: sub.customerRef,
            entitlement: subscriptionToEntitlement(sub),
          };
        }

        case "subscription.renewed": {
          const sub = state.subscriptions.get(payload.subscriptionId!);
          if (!sub) {
            throw new Error(`Subscription not found: ${payload.subscriptionId}`);
          }
          return {
            id: eventId,
            type: "subscription.renewed",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: sub.customerRef,
            entitlement: subscriptionToEntitlement(sub),
          };
        }

        case "subscription.canceled": {
          const sub = state.subscriptions.get(payload.subscriptionId!);
          if (!sub) {
            throw new Error(`Subscription not found: ${payload.subscriptionId}`);
          }
          return {
            id: eventId,
            type: "subscription.canceled",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: sub.customerRef,
            entitlement: subscriptionToEntitlement(sub),
          };
        }

        case "subscription.ended": {
          const sub = state.subscriptions.get(payload.subscriptionId!);
          if (!sub) {
            throw new Error(`Subscription not found: ${payload.subscriptionId}`);
          }
          return {
            id: eventId,
            type: "subscription.ended",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: sub.customerRef,
            entitlement: subscriptionToEntitlement(sub),
          };
        }

        case "payment.succeeded": {
          const payment = state.payments.get(payload.paymentId!);
          return {
            id: eventId,
            type: "payment.succeeded",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: payment?.customerRef ?? null,
            amount: payload.amount ?? payment?.amount ?? 0,
            currency: payload.currency ?? payment?.currency ?? "usd",
          };
        }

        case "payment.failed": {
          const payment = state.payments.get(payload.paymentId!);
          return {
            id: eventId,
            type: "payment.failed",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: payment?.customerRef ?? null,
            amount: payload.amount ?? payment?.amount ?? 0,
            currency: payload.currency ?? payment?.currency ?? "usd",
          };
        }

        case "refund.created": {
          const payment = state.payments.get(payload.paymentId!);
          return {
            id: eventId,
            type: "refund.issued",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: payment?.customerRef ?? null,
            amount: payload.amount ?? 0,
            currency: payload.currency ?? "usd",
          };
        }

        default: {
          // CRITICAL: Unknown event types become unmapped, never dropped
          return {
            id: eventId,
            type: "unmapped",
            provider: MOCK_PROVIDER_NAME,
            occurredAt,
            customerRef: null,
            providerType: payload.type,
            raw: payload,
          };
        }
      }
    },

    async getEntitlement(customerRef: string): Promise<Entitlement | null> {
      const subscriptionId = state.customerSubscriptions.get(customerRef);
      if (!subscriptionId) return null;

      const sub = state.subscriptions.get(subscriptionId);
      if (!sub) return null;

      return subscriptionToEntitlement(sub);
    },

    async createPortalSession(
      customerRef: string,
      returnUrl: string
    ): Promise<{ url: string }> {
      const sessionId = generateId("portal");
      return {
        url: `${baseUrl}/portal/${sessionId}?customer=${encodeURIComponent(customerRef)}&return_url=${encodeURIComponent(returnUrl)}`,
      };
    },

    async refund(paymentId: string, amount?: number): Promise<void> {
      const payment = state.payments.get(paymentId);
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`);
      }
      // In real adapters this would call the provider API
      // For mock, we just track it's been called
      // Amount defaults to full refund if not specified
      const _refundAmount = amount ?? payment.amount;
      // Mock doesn't need to track refunds for now
    },

    get native(): MockNative {
      return {
        state,
        webhookSecret,
        baseUrl,
      };
    },

    // ---------------------------------------------------------------------------
    // Testing utilities — the whole point of a mock
    // ---------------------------------------------------------------------------

    _testing: {
      /**
       * Directly create a subscription (convenience for testing).
       */
      createSubscription(opts: {
        customerRef: string;
        productId: string;
        status?: EntitlementStatus;
        priceId?: string;
      }): MockSubscription {
        const subscriptionId = generateId("sub");
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const subscription: MockSubscription = {
          id: subscriptionId,
          customerRef: opts.customerRef,
          priceId: opts.priceId ?? opts.productId,
          productId: opts.productId,
          status: opts.status ?? "active",
          periodEnd,
          cancelAtPeriodEnd: opts.status === "canceled",
          createdAt: now,
        };

        state.subscriptions.set(subscriptionId, subscription);
        state.customerSubscriptions.set(opts.customerRef, subscriptionId);

        return subscription;
      },

      /**
       * Simulate completing a checkout and creating a subscription.
       */
      async completeCheckout(
        checkoutId: string,
        opts: { productId?: string } = {}
      ): Promise<MockSubscription> {
        const checkout = state.pendingCheckouts.get(checkoutId);
        if (!checkout) {
          throw new Error(`Checkout not found: ${checkoutId}`);
        }

        const subscriptionId = generateId("sub");
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const subscription: MockSubscription = {
          id: subscriptionId,
          customerRef: checkout.customerRef,
          priceId: checkout.priceId,
          productId: opts.productId ?? checkout.priceId, // Default productId to priceId
          status: "active",
          periodEnd,
          cancelAtPeriodEnd: false,
          createdAt: now,
        };

        state.subscriptions.set(subscriptionId, subscription);
        state.customerSubscriptions.set(checkout.customerRef, subscriptionId);
        state.pendingCheckouts.delete(checkoutId);

        return subscription;
      },

      /**
       * Simulate a subscription renewal.
       */
      async renewSubscription(subscriptionId: string): Promise<MockSubscription> {
        const sub = state.subscriptions.get(subscriptionId);
        if (!sub) {
          throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        const newPeriodEnd = new Date(sub.periodEnd);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

        sub.periodEnd = newPeriodEnd;
        sub.status = "active";
        return sub;
      },

      /**
       * Schedule cancellation at period end.
       */
      async cancelSubscription(subscriptionId: string): Promise<MockSubscription> {
        const sub = state.subscriptions.get(subscriptionId);
        if (!sub) {
          throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        sub.cancelAtPeriodEnd = true;
        sub.status = "canceled";
        return sub;
      },

      /**
       * Immediately end a subscription (revoke access now).
       */
      async endSubscription(subscriptionId: string): Promise<MockSubscription> {
        const sub = state.subscriptions.get(subscriptionId);
        if (!sub) {
          throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        sub.status = "expired";
        sub.periodEnd = new Date(); // Access ends now
        return sub;
      },

      /**
       * Set subscription to past_due status.
       */
      async setSubscriptionPastDue(subscriptionId: string): Promise<MockSubscription> {
        const sub = state.subscriptions.get(subscriptionId);
        if (!sub) {
          throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        sub.status = "past_due";
        return sub;
      },

      /**
       * Create a payment record.
       */
      async createPayment(opts: {
        customerRef: string;
        subscriptionId: string;
        amount: number;
        currency?: string;
        status?: "succeeded" | "failed";
      }): Promise<MockPayment> {
        const payment: MockPayment = {
          id: generateId("pay"),
          customerRef: opts.customerRef,
          subscriptionId: opts.subscriptionId,
          amount: opts.amount,
          currency: opts.currency ?? "usd",
          status: opts.status ?? "succeeded",
          createdAt: new Date(),
        };

        state.payments.set(payment.id, payment);
        return payment;
      },

      /**
       * Generate a signed webhook request for testing handleWebhook.
       */
      async createWebhookRequest(payload: MockWebhookPayload): Promise<WebhookRequest> {
        const body = JSON.stringify(payload);
        const signature = await computeSignature(body, webhookSecret);

        return {
          body,
          headers: {
            "x-mock-signature": signature,
            "content-type": "application/json",
          },
          secret: webhookSecret,
        };
      },

      /**
       * Direct access to state for assertions.
       */
      getState(): MockState {
        return state;
      },

      /**
       * Reset all state.
       */
      reset(): void {
        state.subscriptions.clear();
        state.payments.clear();
        state.customerSubscriptions.clear();
        state.pendingCheckouts.clear();
      },
    },
  };

  return provider;
}

// ---------------------------------------------------------------------------
// Mock-specific types for external use
// ---------------------------------------------------------------------------

export interface MockNative {
  state: MockState;
  webhookSecret: string;
  baseUrl: string;
}

export interface MockTestingUtils {
  createSubscription(opts: {
    customerRef: string;
    productId: string;
    status?: EntitlementStatus;
    priceId?: string;
  }): MockSubscription;
  completeCheckout(
    checkoutId: string,
    opts?: { productId?: string }
  ): Promise<MockSubscription>;
  renewSubscription(subscriptionId: string): Promise<MockSubscription>;
  cancelSubscription(subscriptionId: string): Promise<MockSubscription>;
  endSubscription(subscriptionId: string): Promise<MockSubscription>;
  setSubscriptionPastDue(subscriptionId: string): Promise<MockSubscription>;
  createPayment(opts: {
    customerRef: string;
    subscriptionId: string;
    amount: number;
    currency?: string;
    status?: "succeeded" | "failed";
  }): Promise<MockPayment>;
  createWebhookRequest(payload: MockWebhookPayload): Promise<WebhookRequest>;
  getState(): MockState;
  reset(): void;
}

export interface MockProvider extends BillingProvider {
  readonly native: MockNative;
  readonly _testing: MockTestingUtils;
}
