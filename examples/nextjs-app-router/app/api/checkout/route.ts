import { NextRequest, NextResponse } from "next/server";
import { getBilling, getCurrentUserId } from "@/lib/billing";

export const runtime = "nodejs";
/** Accept HTML forms or JSON { priceId }. Identity always comes from auth. */
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId)
      return NextResponse.json(
        { error: "Sign in to subscribe" },
        { status: 401 },
      );
    const baseUrl = new URL(
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    ).origin;
    if (request.headers.get("origin") !== baseUrl) {
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403 },
      );
    }
    const isJson = request.headers
      .get("content-type")
      ?.includes("application/json");
    let priceId: unknown;
    try {
      priceId = isJson
        ? (await request.json())?.priceId
        : (await request.formData()).get("priceId");
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }
    const allowedPrices = [
      process.env.STRIPE_PRO_PRICE_ID,
      process.env.STRIPE_ENTERPRISE_PRICE_ID,
    ].filter(Boolean);
    if (typeof priceId !== "string" || !allowedPrices.includes(priceId)) {
      return NextResponse.json({ error: "Unknown price" }, { status: 400 });
    }
    const checkout = await getBilling().createCheckout({
      priceId,
      customerRef: userId,
      successUrl: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/billing/cancel`,
    });
    return isJson
      ? NextResponse.json({ url: checkout.url })
      : NextResponse.redirect(checkout.url, 303);
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
