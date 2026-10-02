import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { CartLineItem } from "@/components/cart-line-item";
import { EmptyState } from "@/components/empty-state";
import { getCart } from "@/lib/data/cart";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Cart" };

export default async function CartPage() {
  const cart = await getCart();

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Browse the shop and add something you love."
        action={{ href: "/products", label: "Start shopping" }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">Your cart</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white" aria-label="Cart items">
          {cart.lines.map((line) => (
            <li key={line.product_id}>
              <CartLineItem line={line} />
            </li>
          ))}
        </ul>
        <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 lg:sticky lg:top-24" aria-label="Cart summary">
          <h2 className="text-base font-semibold text-neutral-900">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-600">Items</dt>
              <dd data-testid="summary-items">{cart.itemCount}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Subtotal</dt>
              <dd data-testid="summary-subtotal">{cart.currency ? formatMoney(cart.subtotalCents, cart.currency) : "—"}</dd>
            </div>
          </dl>
          {cart.hasIssues && <Alert tone="warning">Some items in your cart need attention.</Alert>}
          <p className="text-xs text-neutral-500">Checkout is coming soon. Your cart is saved on this device.</p>
          <Link
            href="/products"
            className="block w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-center text-sm font-medium text-neutral-900 hover:bg-neutral-50"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
