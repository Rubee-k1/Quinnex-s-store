"use client";

import Link from "next/link";
import { useActionState } from "react";
import { removeCartItem, setCartItemQuantity } from "@/actions/cart";
import { initialFormState } from "@/actions/state";
import type { CartLine } from "@/lib/data/cart";
import { formatMoney } from "@/lib/money";
import { ProductImage } from "./product-image";

const stepButton =
  "flex size-9 items-center justify-center text-lg text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent";

export function CartLineItem({ line }: { line: CartLine }) {
  const [qtyState, qtyAction, updating] = useActionState(setCartItemQuantity, initialFormState);
  const [removeState, removeAction, removing] = useActionState(removeCartItem, initialFormState);
  const unavailable = line.issue === "unavailable";
  const busy = updating || removing;
  const error = qtyState.status === "error" ? qtyState.message : removeState.status === "error" ? removeState.message : null;
  const canIncrease = !unavailable && line.quantity < Math.min(line.stock, 99);

  return (
    <div className={`flex gap-4 p-4 ${removing ? "opacity-50" : ""}`} data-testid={`cart-line-${line.slug}`}>
      <ProductImage src={line.image_url} alt={line.name} className="size-20 shrink-0 rounded-lg sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {unavailable ? (
              <p className="font-medium text-neutral-500">{line.name}</p>
            ) : (
              <Link href={`/products/${line.slug}`} className="font-medium text-neutral-900 hover:underline">
                {line.name}
              </Link>
            )}
            <p className="text-sm text-neutral-600">{formatMoney(line.price_cents, line.currency)} each</p>
          </div>
          {!unavailable && <p className="shrink-0 text-sm font-semibold">{formatMoney(line.lineTotalCents, line.currency)}</p>}
        </div>

        {unavailable && <p className="text-sm text-red-700">This product is no longer available. Please remove it.</p>}
        {line.issue === "insufficient_stock" && (
          <p className="text-sm text-amber-700">
            {line.stock > 0 ? `Only ${line.stock} left — please reduce the quantity.` : "This product is now out of stock."}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-4">
          {!unavailable && (
            <form action={qtyAction} className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-300">
              <input type="hidden" name="productId" value={line.product_id} />
              <button
                type="submit"
                name="quantity"
                value={line.quantity - 1}
                disabled={busy || line.quantity <= 1}
                className={stepButton}
                aria-label={`Decrease quantity of ${line.name}`}
              >
                −
              </button>
              <output className="min-w-10 px-2 text-center text-sm tabular-nums" aria-label={`Quantity of ${line.name}`}>
                {updating ? "…" : line.quantity}
              </output>
              <button
                type="submit"
                name="quantity"
                value={line.quantity + 1}
                disabled={busy || !canIncrease}
                className={stepButton}
                aria-label={`Increase quantity of ${line.name}`}
              >
                +
              </button>
            </form>
          )}
          <form action={removeAction}>
            <input type="hidden" name="productId" value={line.product_id} />
            <button
              type="submit"
              disabled={busy}
              className="text-sm text-neutral-600 underline hover:text-neutral-900 disabled:text-neutral-300"
              aria-label={`Remove ${line.name}`}
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
          {!canIncrease && !unavailable && line.issue === null && (
            <span className="text-xs text-neutral-500">Maximum available</span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
