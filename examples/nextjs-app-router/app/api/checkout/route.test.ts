import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
const { auth, createCheckout } = vi.hoisted(() => ({
  auth: vi.fn(),
  createCheckout: vi.fn(),
}));
vi.mock("@/lib/billing", () => ({
  getCurrentUserId: auth,
  getBilling: () => ({ createCheckout }),
}));
function request(body: string, form = false, origin = "https://app.test") {
  return new NextRequest("https://app.test/api/checkout", {
    method: "POST",
    body,
    headers: {
      origin,
      "content-type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
    },
  });
}
beforeEach(() => {
  auth.mockResolvedValue("authenticated_user");
  createCheckout.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro");
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("checkout route", () => {
  it("rejects signed-out callers before creating checkout", async () => {
    auth.mockResolvedValue(null);
    expect((await POST(request('{"priceId":"price_pro"}'))).status).toBe(401);
    expect(createCheckout).not.toHaveBeenCalled();
  });
  it("uses authenticated identity and ignores forged body identity", async () => {
    const response = await POST(
      request('{"priceId":"price_pro","userId":"victim"}'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/test",
    });
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerRef: "authenticated_user",
        priceId: "price_pro",
      }),
    );
  });
  it("accepts the HTML pricing form and redirects with GET", async () => {
    const response = await POST(request("priceId=price_pro", true));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://checkout.stripe.com/test",
    );
  });
  it.each(['{"priceId":"price_unlisted"}', "{", "null", '{"priceId":123}'])(
    "rejects invalid body %s",
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(createCheckout).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin checkout requests", async () => {
    expect(
      (
        await POST(
          request('{"priceId":"price_pro"}', false, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
