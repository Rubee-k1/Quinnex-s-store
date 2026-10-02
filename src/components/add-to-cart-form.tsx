"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addToCart } from "@/actions/cart";
import { initialFormState } from "@/actions/state";
import { Alert } from "./alert";
import { SubmitButton } from "./submit-button";

type Props = { productId: string; maxQuantity: number };

export function AddToCartForm({ productId, maxQuantity }: Props) {
  const [state, formAction] = useActionState(addToCart, initialFormState);

  if (maxQuantity < 1) {
    return (
      <button type="button" disabled className="w-full rounded-lg bg-neutral-200 px-4 py-3 text-sm font-medium text-neutral-500 sm:w-auto">
        Out of stock
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div>
          <label htmlFor="quantity" className="mb-1 block text-sm font-medium text-neutral-800">
            Quantity
          </label>
          <select
            id="quantity"
            name="quantity"
            defaultValue="1"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm sm:w-24"
          >
            {Array.from({ length: Math.min(maxQuantity, 10) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Adding…" className="w-full py-3 sm:w-48">
          Add to cart
        </SubmitButton>
      </div>
      {state.status === "error" && <Alert tone="error">{state.message}</Alert>}
      {state.status === "success" && (
        <Alert tone="success">
          {state.message}{" "}
          <Link href="/cart" className="font-medium underline">
            View cart
          </Link>
        </Alert>
      )}
    </form>
  );
}
