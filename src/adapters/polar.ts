import { POLAR_CAPABILITIES } from "./capabilities.js";
import { Polar } from "@polar-sh/sdk";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import { Webhook } from "standardwebhooks";
import type {
  BillingEvent,
  BillingProvider,
  Entitlement,
  EntitlementStatus,
  WebhookRequest,
} from "../types.js";
import { WebhookVerificationError } from "../types.js";

export interface PolarProviderOptions {
  accessToken: string;
  webhookSecret: string;
  sandbox?: boolean;
}
export interface PolarProvider extends BillingProvider {
  readonly native: Polar;
}
const CUSTOMER_REF_KEY = "billing_sdk_customer_ref";
type SubscriptionState = Pick<
  Subscription,
  "status" | "cancelAtPeriodEnd" | "currentPeriodEnd" | "productId"
>;

function toEntitlement(
  sub: SubscriptionState,
  customerRef: string,
): Entitlement {
  let status: EntitlementStatus = "expired";
  if (sub.status === "active")
    status = sub.cancelAtPeriodEnd ? "canceled" : "active";
  else if (sub.status === "trialing") status = "trialing";
  else if (sub.status === "past_due") status = "past_due";
  const pastCancellation =
    sub.cancelAtPeriodEnd && sub.currentPeriodEnd.getTime() <= Date.now();
  return {
    active:
      (status === "active" || status === "trialing" || status === "canceled") &&
      !pastCancellation,
    status: pastCancellation ? "expired" : status,
    productId: sub.productId,
    customerRef,
    periodEnd: new Date(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    provider: "polar",
  };
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function customerRef(data: Record<string, unknown>): string | null {
  const value =
    record(data.metadata)[CUSTOMER_REF_KEY] ??
    record(record(data.subscription).metadata)[CUSTOMER_REF_KEY] ??
    record(data.customer).external_id ??
    data.external_id;
  return typeof value === "string" ? value : null;
}
function subscriptionFromWebhook(
  data: Record<string, unknown>,
): SubscriptionState {
  const period =
    typeof data.current_period_end === "string"
      ? new Date(data.current_period_end)
      : new Date(NaN);
  if (
    typeof data.status !== "string" ||
    typeof data.product_id !== "string" ||
    typeof data.cancel_at_period_end !== "boolean" ||
    !Number.isFinite(period.getTime())
  ) {
    throw new TypeError("Malformed Polar subscription webhook");
  }
  return {
    status: data.status as Subscription["status"],
    productId: data.product_id,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    currentPeriodEnd: period,
  };
}
function normalizeWebhook(
  event: Record<string, unknown>,
  headers: Record<string, string>,
): BillingEvent {
  if (
    typeof event.type !== "string" ||
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    throw new TypeError("Malformed Polar webhook envelope");
  }
  const data = record(event.data);
  const occurredAt =
    typeof event.timestamp === "string"
      ? new Date(event.timestamp)
      : new Date(Number(headers["webhook-timestamp"]) * 1000);
  if (!Number.isFinite(occurredAt.getTime()))
    throw new TypeError("Invalid Polar event timestamp");
  const ref = customerRef(data);
  const base = {
    id: headers["webhook-id"]!,
    provider: "polar",
    occurredAt,
    customerRef: ref,
  };
  const mapped = {
    "subscription.created": "subscription.started",
    "subscription.cycled": "subscription.renewed",
    "subscription.canceled": "subscription.canceled",
    "subscription.revoked": "subscription.ended",
  } as const;
  if (Object.hasOwn(mapped, event.type)) {
    const type = mapped[event.type as keyof typeof mapped];
    const entitlement = toEntitlement(subscriptionFromWebhook(data), ref ?? "");
    if (type === "subscription.ended") {
      entitlement.active = false;
      entitlement.status = "expired";
    }
    return { ...base, type, entitlement };
  }
  if (event.type === "order.paid" || event.type === "order.refunded") {
    // order.refunded reports cumulative refunded principal + refunded tax.
    const amount =
      event.type === "order.paid"
        ? data.total_amount
        : typeof data.refunded_amount === "number" &&
            typeof data.refunded_tax_amount === "number"
          ? data.refunded_amount + data.refunded_tax_amount
          : undefined;
    if (
      !Number.isSafeInteger(amount) ||
      (amount as number) < 0 ||
      typeof data.currency !== "string"
    ) {
      throw new TypeError("Malformed Polar order webhook");
    }
    return {
      ...base,
      type: event.type === "order.paid" ? "payment.succeeded" : "refund.issued",
      amount: amount as number,
      currency: data.currency,
    };
  }
  // Preserve unknown verified events, including attribution for invalidation.
  return {
    ...base,
    type: "unmapped",
    providerType: event.type,
    raw: event.data,
  };
}

export function polar(options: PolarProviderOptions): PolarProvider {
  const client = new Polar({
    accessToken: options.accessToken,
    server: options.sandbox ? "sandbox" : "production",
  });
  async function findSubscription(ref: string): Promise<Subscription | null> {
    // Server-side metadata filtering supports both existing and new checkouts.
    const pages = await client.subscriptions.list({
      metadata: { [CUSTOMER_REF_KEY]: ref },
      limit: 100,
    });
    const candidates: Subscription[] = [];
    for await (const page of pages) {
      for (const sub of page.result.items) {
        if (sub.metadata[CUSTOMER_REF_KEY] === ref) candidates.push(sub);
      }
    }
    candidates.sort(
      (a, b) =>
        Number(toEntitlement(b, ref).active) -
          Number(toEntitlement(a, ref).active) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    return candidates[0] ?? null;
  }
  return {
    name: "polar",
    capabilities: { ...POLAR_CAPABILITIES },
    native: client,
    async createCheckout(req) {
      const session = await client.checkouts.create({
        products: [req.priceId],
        successUrl: req.successUrl,
        returnUrl: req.cancelUrl,
        customerEmail: req.email,
        externalCustomerId: req.customerRef,
        metadata: { ...req.metadata, [CUSTOMER_REF_KEY]: req.customerRef },
      });
      return { id: session.id, url: session.url, provider: "polar" };
    },
    async handleWebhook(req: WebhookRequest) {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      );
      let verified: unknown;
      try {
        // Verify the original bytes before parsing/normalizing. Using Standard
        // Webhooks directly also preserves future events unknown to the SDK.
        verified = new Webhook(
          Buffer.from(req.secret, "utf8").toString("base64"),
        ).verify(req.body, headers);
      } catch (error) {
        throw new WebhookVerificationError(
          error instanceof Error ? error.message : undefined,
        );
      }
      return normalizeWebhook(record(verified), headers);
    },
    async getEntitlement(ref) {
      const sub = await findSubscription(ref);
      return sub ? toEntitlement(sub, ref) : null;
    },
    async createPortalSession(ref, returnUrl) {
      const sub = await findSubscription(ref);
      if (!sub)
        throw new Error(`No subscription found for customerRef: ${ref}`);
      const session = await client.customerSessions.create({
        customerId: sub.customerId,
        returnUrl,
      });
      return { url: session.customerPortalUrl };
    },
    async refund(paymentId, amount) {
      const refundAmount =
        amount ?? (await client.orders.get({ id: paymentId })).refundableAmount;
      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0)
        throw new RangeError(
          "Refund amount must be a positive integer in minor units",
        );
      await client.refunds.create({
        orderId: paymentId,
        reason: "customer_request",
        amount: refundAmount,
      });
    },
  };
}
