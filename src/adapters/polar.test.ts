import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { polar } from "./polar.js";
import { WebhookVerificationError } from "../types.js";

const secret = "polar-test-secret";
const makeProvider = () =>
  polar({ accessToken: "test", webhookSecret: secret, sandbox: true });
const rawSub = (overrides: Record<string, unknown> = {}) => ({
  status: "active",
  cancel_at_period_end: false,
  current_period_end: new Date(Date.now() + 60_000).toISOString(),
  product_id: "prod_pro",
  customer_id: "cus_1",
  metadata: { billing_sdk_customer_ref: "user_1" },
  ...overrides,
});
const sdkSub = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  productId: "prod_pro",
  customerId: "cus_1",
  metadata: { billing_sdk_customer_ref: "user_1" },
  ...overrides,
});
function signed(
  type: string,
  data: unknown = {},
  timestamp = new Date().toISOString(),
) {
  const body = JSON.stringify({ type, data, timestamp });
  const time = String(Math.floor(Date.now() / 1000));
  return {
    body,
    secret,
    headers: {
      "webhook-id": "msg_stable",
      "webhook-timestamp": time,
      "webhook-signature": `v1,${createHmac("sha256", secret).update(`msg_stable.${time}.${body}`).digest("base64")}`,
    },
  };
}
function mockPages(
  provider: ReturnType<typeof makeProvider>,
  pages: Record<string, unknown>[][],
) {
  return vi.spyOn(provider.native.subscriptions, "list").mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      for (const items of pages) yield { result: { items } };
    },
  } as never);
}
afterEach(() => vi.restoreAllMocks());

describe("Polar signed webhook normalization", () => {
  it.each([
    ["active", false, "active", true],
    ["trialing", false, "trialing", true],
    ["past_due", false, "past_due", false],
    ["canceled", false, "expired", false],
    ["unpaid", false, "expired", false],
    ["incomplete", false, "expired", false],
    ["incomplete_expired", false, "expired", false],
    ["future_status", false, "expired", false],
    ["active", true, "canceled", true],
  ])(
    "maps status %s with cancellation %s",
    async (status, cancel, expectedStatus, active) => {
      const event = await makeProvider().handleWebhook(
        signed(
          "subscription.created",
          rawSub({ status, cancel_at_period_end: cancel }),
        ),
      );
      expect(event).toMatchObject({
        type: "subscription.started",
        customerRef: "user_1",
        entitlement: {
          status: expectedStatus,
          active,
          productId: "prod_pro",
          periodEnd: expect.any(Date),
        },
      });
    },
  );
  it.each([
    ["subscription.cycled", "subscription.renewed"],
    ["subscription.canceled", "subscription.canceled"],
    ["subscription.revoked", "subscription.ended"],
  ])("maps %s", async (type, normalized) => {
    const event = await makeProvider().handleWebhook(
      signed(type, rawSub({ cancel_at_period_end: true })),
    );
    expect(event.type).toBe(normalized);
    if ("entitlement" in event)
      expect(event.entitlement.active).toBe(type !== "subscription.revoked");
  });
  it("does not grant access past a canceled period", async () => {
    const event = await makeProvider().handleWebhook(
      signed(
        "subscription.canceled",
        rawSub({
          cancel_at_period_end: true,
          current_period_end: new Date(Date.now() - 1).toISOString(),
        }),
      ),
    );
    expect(event).toMatchObject({
      entitlement: { active: false, status: "expired" },
    });
  });
  it("preserves event identity and occurrence time across retries", async () => {
    const req = signed(
      "subscription.created",
      rawSub(),
      "2026-01-01T00:00:00.000Z",
    );
    const provider = makeProvider();
    const a = await provider.handleWebhook(req);
    const b = await provider.handleWebhook(req);
    expect(a.id).toBe("msg_stable");
    expect(b.id).toBe(a.id);
    expect(a.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it.each(["subscription.updated", "subscription.past_due", "future.event"])(
    "preserves attribution for %s",
    async (type) => {
      expect(
        await makeProvider().handleWebhook(signed(type, rawSub())),
      ).toMatchObject({
        type: "unmapped",
        providerType: type,
        customerRef: "user_1",
        raw: { product_id: "prod_pro" },
      });
    },
  );
  it("extracts external customer identity for state events", async () => {
    expect(
      await makeProvider().handleWebhook(
        signed("customer.state_changed", { external_id: "user_1" }),
      ),
    ).toMatchObject({ customerRef: "user_1" });
  });
  it("uses order total and actual refunded amount including tax", async () => {
    const data = {
      total_amount: 1200,
      refunded_amount: 200,
      refunded_tax_amount: 20,
      currency: "eur",
      customer: { external_id: "user_1" },
    };
    expect(
      await makeProvider().handleWebhook(signed("order.paid", data)),
    ).toMatchObject({
      type: "payment.succeeded",
      amount: 1200,
      currency: "eur",
      customerRef: "user_1",
    });
    expect(
      await makeProvider().handleWebhook(signed("order.refunded", data)),
    ).toMatchObject({ type: "refund.issued", amount: 220 });
  });
  it("accepts case-insensitive headers", async () => {
    const req = signed("future.event");
    req.headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toUpperCase(), v]),
    ) as typeof req.headers;
    expect((await makeProvider().handleWebhook(req)).type).toBe("unmapped");
  });
  it("rejects tampering, wrong secrets and missing signatures", async () => {
    const provider = makeProvider();
    const req = signed("future.event");
    for (const bad of [
      { ...req, body: req.body + " " },
      { ...req, secret: "wrong" },
      { ...req, headers: {} },
    ]) {
      await expect(provider.handleWebhook(bad)).rejects.toBeInstanceOf(
        WebhookVerificationError,
      );
    }
  });
  it("rejects replay outside timestamp tolerance", async () => {
    const req = signed("future.event");
    req.headers["webhook-timestamp"] = "1";
    req.headers["webhook-signature"] =
      `v1,${createHmac("sha256", secret).update(`msg_stable.1.${req.body}`).digest("base64")}`;
    await expect(makeProvider().handleWebhook(req)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });
  it("distinguishes signed malformed data from invalid signatures", async () => {
    await expect(
      makeProvider().handleWebhook(signed("subscription.created", {})),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      makeProvider().handleWebhook(signed("order.paid", {})),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("Polar API operations", () => {
  it("filters server-side, follows pages, and prefers an active subscription", async () => {
    const provider = makeProvider();
    const list = mockPages(provider, [
      [
        sdkSub({ status: "canceled" }),
        sdkSub({ metadata: { billing_sdk_customer_ref: "another_user" } }),
      ],
      [sdkSub({ id: "sub_active", productId: "prod_paid" })],
    ]);
    const entitlement = await provider.getEntitlement("user_1");
    expect(list).toHaveBeenCalledWith({
      metadata: { billing_sdk_customer_ref: "user_1" },
      limit: 100,
    });
    expect(entitlement).toMatchObject({
      active: true,
      productId: "prod_paid",
      periodEnd: expect.any(Date),
      cancelAtPeriodEnd: false,
    });
  });
  it("returns null only when no matching subscription exists", async () => {
    const provider = makeProvider();
    mockPages(provider, [[]]);
    expect(await provider.getEntitlement("missing")).toBeNull();
  });
  it("propagates provider outages instead of converting them to free users", async () => {
    const provider = makeProvider();
    vi.spyOn(provider.native.subscriptions, "list").mockRejectedValue(
      new Error("429 rate limited"),
    );
    await expect(provider.getEntitlement("user_1")).rejects.toThrow("429");
  });
  it("protects identity metadata and sets external ID and return URL", async () => {
    const provider = makeProvider();
    const create = vi
      .spyOn(provider.native.checkouts, "create")
      .mockResolvedValue({
        id: "checkout",
        url: "https://polar.sh/checkout",
      } as never);
    await provider.createCheckout({
      priceId: "prod_pro",
      customerRef: "user_1",
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/back",
      metadata: { billing_sdk_customer_ref: "forged" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCustomerId: "user_1",
        returnUrl: "https://app.test/back",
        metadata: { billing_sdk_customer_ref: "user_1" },
      }),
    );
  });
  it("uses SDK customerId and honors portal return URL", async () => {
    const provider = makeProvider();
    mockPages(provider, [[sdkSub()]]);
    const create = vi
      .spyOn(provider.native.customerSessions, "create")
      .mockResolvedValue({
        customerPortalUrl: "https://polar.sh/portal",
      } as never);
    expect(
      await provider.createPortalSession!("user_1", "https://app.test"),
    ).toEqual({ url: "https://polar.sh/portal" });
    expect(create).toHaveBeenCalledWith({
      customerId: "cus_1",
      returnUrl: "https://app.test",
    });
  });
  it("supports full remaining refunds", async () => {
    const provider = makeProvider();
    vi.spyOn(provider.native.orders, "get").mockResolvedValue({
      refundableAmount: 700,
    } as never);
    const create = vi
      .spyOn(provider.native.refunds, "create")
      .mockResolvedValue({} as never);
    await provider.refund!("order_1");
    expect(create).toHaveBeenCalledWith({
      orderId: "order_1",
      amount: 700,
      reason: "customer_request",
    });
  });
  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid refund %s",
    async (amount) => {
      const provider = makeProvider();
      const create = vi.spyOn(provider.native.refunds, "create");
      await expect(provider.refund!("order_1", amount)).rejects.toThrow(
        RangeError,
      );
      expect(create).not.toHaveBeenCalled();
    },
  );
});
