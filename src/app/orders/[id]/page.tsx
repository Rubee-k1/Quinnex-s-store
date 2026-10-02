import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/alert";
import { OrderSummary } from "@/components/order-summary";
import { getOrderForVisitor } from "@/lib/data/orders";

export const metadata: Metadata = { title: "Order confirmation", robots: { index: false } };

const countryName = (code: string) => new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { placed } = await searchParams;
  const order = await getOrderForVisitor(id);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {placed === "1" && (
        <Alert tone="success">
          <p className="text-base font-semibold">Thank you, your order has been placed!</p>
          <p>We&apos;ve saved your order. Keep your order number for reference.</p>
        </Alert>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">Order #{order.order_number}</h1>
          <p className="text-sm text-neutral-600">
            Placed {new Date(order.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium capitalize text-amber-800" data-testid="order-status">
          {order.status}
        </span>
      </div>

      <OrderSummary
        title="Items"
        lines={order.items.map((i) => ({
          key: i.id,
          name: i.product_name,
          quantity: i.quantity,
          unitPriceCents: i.unit_price_cents,
          lineTotalCents: i.line_total_cents,
        }))}
        currency={order.currency}
        subtotalCents={order.subtotal_cents}
        shippingCents={order.shipping_cents}
        totalCents={order.total_cents}
        note={order.status === "pending" ? "Payment has not been taken. We'll be in touch about payment and delivery." : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-neutral-900">Shipping to</h2>
          <address className="not-italic leading-relaxed text-neutral-700">
            {order.customer_name}
            <br />
            {order.shipping_line1}
            {order.shipping_line2 && (
              <>
                <br />
                {order.shipping_line2}
              </>
            )}
            <br />
            {[order.shipping_city, order.shipping_state, order.shipping_postal_code].filter(Boolean).join(", ")}
            <br />
            {countryName(order.shipping_country)}
          </address>
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold text-neutral-900">Contact</h2>
          <p className="text-neutral-700">{order.email}</p>
          {order.phone && <p className="text-neutral-700">{order.phone}</p>}
        </section>
      </div>

      <Link
        href="/products"
        className="inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Continue shopping
      </Link>
    </div>
  );
}
