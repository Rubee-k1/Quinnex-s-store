import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { CheckoutForm } from "@/components/checkout-form";
import { EmptyState } from "@/components/empty-state";
import { OrderSummary } from "@/components/order-summary";
import { getUser } from "@/lib/auth";
import { getCartToken } from "@/lib/cart-token";
import { countryOptions } from "@/lib/countries";
import { getCart } from "@/lib/data/cart";
import { getCartFingerprint } from "@/lib/data/orders";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const [cart, token, user] = await Promise.all([getCart(), getCartToken(), getUser()]);

  if (!token || cart.lines.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Add some products to your cart before checking out."
        action={{ href: "/products", label: "Browse products" }}
      />
    );
  }

  const header = (
    <div>
      <Link href="/cart" className="text-sm text-neutral-600 hover:text-neutral-900">
        ← Back to cart
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">Checkout</h1>
    </div>
  );

  if (cart.hasIssues || !cart.currency) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning">
          <p className="font-medium">Some items in your cart need attention before you can check out.</p>
          <ul className="mt-1 list-disc pl-5">
            {cart.lines
              .filter((l) => l.issue)
              .map((l) => (
                <li key={l.product_id}>
                  {l.issue === "unavailable"
                    ? `${l.name} is no longer available.`
                    : `${l.name}: only ${l.stock} left (you have ${l.quantity}).`}
                </li>
              ))}
          </ul>
          <Link href="/cart" className="mt-2 inline-block font-medium underline">
            Update your cart
          </Link>
        </Alert>
      </div>
    );
  }

  const fingerprint = await getCartFingerprint(token);

  return (
    <div className="space-y-6">
      {header}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
          {/* A fresh key per page render: resubmitting this form returns the same order. */}
          <CheckoutForm idempotencyKey={randomUUID()} cartFingerprint={fingerprint} countries={countryOptions()} defaultEmail={user?.email} />
        </section>
        <div className="lg:sticky lg:top-24">
          <OrderSummary
            lines={cart.lines.map((l) => ({
              key: l.product_id,
              name: l.name,
              quantity: l.quantity,
              unitPriceCents: l.price_cents,
              lineTotalCents: l.lineTotalCents,
              imageUrl: l.image_url,
            }))}
            currency={cart.currency}
            subtotalCents={cart.subtotalCents}
            shippingCents={0}
            totalCents={cart.subtotalCents}
            note="Prices and stock are confirmed again when you place the order."
          />
        </div>
      </div>
    </div>
  );
}
