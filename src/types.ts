/**
 * @opencoredev/billing-sdk
 *
 * The interface, written before any provider exists.
 *
 * Design rule: if two providers can't do a thing with the same semantics,
 * it does not go in this file. It goes in `capabilities` or it stays native.
 */

// ---------------------------------------------------------------------------
// Capabilities — the honesty mechanism
// ---------------------------------------------------------------------------

/**
 * Every adapter declares what it can actually do. Callers branch on this
 * instead of discovering gaps at runtime. Never lie here.
 */
export interface Capabilities {
  webhookVerification: boolean;
  customerPortal: boolean;
  /** Provider is the legal seller and remits tax. */
  merchantOfRecord: boolean;
  /** Metered/usage billing. Deliberately NOT abstracted in v1. */
  usageBilling: boolean;
  /** Mid-cycle plan changes with proration. Deliberately NOT abstracted in v1. */
  proration: boolean;
  refunds: boolean;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface CheckoutRequest {
  /** Provider-native price/variant/product id. We do not invent a catalog. */
  priceId: string;
  /** Your user's id. Round-trips through metadata so webhooks are attributable. */
  customerRef: string;
  email?: string;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface Checkout {
  id: string;
  url: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Entitlement — the thing your app actually asks about
// ---------------------------------------------------------------------------

export type EntitlementStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled" // still has access until periodEnd
  | "expired"; // access is gone

export interface Entitlement {
  /** The only field most apps need. Derived, never guessed. */
  active: boolean;
  status: EntitlementStatus;
  productId: string;
  customerRef: string;
  periodEnd: Date | null;
  /** True when canceled but still inside the paid period. */
  cancelAtPeriodEnd: boolean;
  provider: string;
}

// ---------------------------------------------------------------------------
// Events — a deliberately small normalized set
// ---------------------------------------------------------------------------

interface EventBase {
  id: string;
  provider: string;
  occurredAt: Date;
  customerRef: string | null;
}

export type BillingEvent =
  | (EventBase & { type: "subscription.started"; entitlement: Entitlement })
  | (EventBase & { type: "subscription.renewed"; entitlement: Entitlement })
  /** Cancellation *scheduled*. Access usually continues to periodEnd. */
  | (EventBase & { type: "subscription.canceled"; entitlement: Entitlement })
  /** Access is actually gone as of now. This is the one that revokes. */
  | (EventBase & { type: "subscription.ended"; entitlement: Entitlement })
  | (EventBase & { type: "payment.succeeded"; amount: number; currency: string })
  | (EventBase & { type: "payment.failed"; amount: number; currency: string })
  | (EventBase & { type: "refund.issued"; amount: number; currency: string })
  /**
   * Critical: the provider sent something real that we do not model.
   * We surface it rather than swallowing it. Callers can drop to `raw`.
   */
  | (EventBase & { type: "unmapped"; providerType: string; raw: unknown });

export interface WebhookRequest {
  body: string; // raw, unparsed — signature verification needs exact bytes
  headers: Record<string, string>;
  secret: string;
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

export interface BillingProvider {
  readonly name: string;
  readonly capabilities: Capabilities;

  createCheckout(req: CheckoutRequest): Promise<Checkout>;

  /** Verifies signature and normalizes. Throws on bad signature — never returns null. */
  handleWebhook(req: WebhookRequest): Promise<BillingEvent>;

  /** Source of truth is the provider. We never cache entitlement state for you. */
  getEntitlement(customerRef: string): Promise<Entitlement | null>;

  /** Requires capabilities.customerPortal. */
  createPortalSession?(customerRef: string, returnUrl: string): Promise<{ url: string }>;

  /** Requires capabilities.refunds. */
  refund?(paymentId: string, amount?: number): Promise<void>;

  /** Escape hatch. Always available, always documented. */
  readonly native: unknown;
}

// ---------------------------------------------------------------------------
// Client wrapper
// ---------------------------------------------------------------------------

export interface BillingClient extends Omit<BillingProvider, "native"> {
  native<T>(): T;
}

export interface CreateBillingClientOptions {
  provider: BillingProvider;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WebhookVerificationError extends Error {
  constructor(message: string = "Webhook signature verification failed") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
