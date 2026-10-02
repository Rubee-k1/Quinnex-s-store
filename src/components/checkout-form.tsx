"use client";

import Link from "next/link";
import { useActionState } from "react";
import { placeOrder } from "@/actions/checkout";
import { initialFormState } from "@/actions/state";
import { Alert } from "./alert";
import { Field } from "./field";
import { SubmitButton } from "./submit-button";

type Props = {
  idempotencyKey: string;
  cartFingerprint: string;
  countries: { code: string; name: string }[];
  /** Pre-fills the email for signed-in customers. */
  defaultEmail?: string;
};

export function CheckoutForm({ idempotencyKey, cartFingerprint, countries, defaultEmail }: Props) {
  const [state, formAction] = useActionState(placeOrder, initialFormState);
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  // Hidden fields can't be "highlighted", so explain them directly.
  const sessionError = e.idempotencyKey ?? e.cartFingerprint;

  return (
    // Keyed by the checkout session: when the server re-renders the page with a
    // new key/fingerprint (e.g. after "cart changed"), the form remounts so the
    // hidden fields can't go stale. Typed details survive via `state.values`.
    <form key={`${idempotencyKey}:${cartFingerprint}`} action={formAction} className="space-y-6" noValidate aria-label="Checkout">
      <input type="hidden" name="idempotencyKey" defaultValue={idempotencyKey} />
      <input type="hidden" name="cartFingerprint" defaultValue={cartFingerprint} />

      {state.status === "error" && state.message && (
        <Alert tone="error">
          <p className="font-medium">We couldn&apos;t place your order.</p>
          <p>{sessionError ?? state.message}</p>
          {!state.fieldErrors && (
            <Link href="/cart" className="mt-1 inline-block font-medium underline">
              Review your cart
            </Link>
          )}
        </Alert>
      )}

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-neutral-900">Contact</legend>
        <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={v.email ?? defaultEmail} error={e.email} hint="We'll use this to contact you about your order." />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} error={e.phone} />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-neutral-900">Shipping address</legend>
        <Field label="Full name" name="name" autoComplete="name" required defaultValue={v.name} error={e.name} />
        <Field label="Address" name="line1" autoComplete="address-line1" required defaultValue={v.line1} error={e.line1} />
        <Field label="Apartment, suite, etc." name="line2" autoComplete="address-line2" defaultValue={v.line2} error={e.line2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" name="city" autoComplete="address-level2" required defaultValue={v.city} error={e.city} />
          <Field label="State / region" name="state" autoComplete="address-level1" defaultValue={v.state} error={e.state} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postal code" name="postalCode" autoComplete="postal-code" required defaultValue={v.postalCode} error={e.postalCode} />
          <div>
            <label htmlFor="field-country" className="mb-1 block text-sm font-medium text-neutral-800">
              Country
            </label>
            <select
              id="field-country"
              name="country"
              autoComplete="country"
              required
              defaultValue={v.country ?? ""}
              aria-invalid={e.country ? true : undefined}
              aria-describedby={e.country ? "field-country-error" : undefined}
              className={`block w-full rounded-lg border bg-white px-3 py-2.5 text-sm ${e.country ? "border-red-500" : "border-neutral-300"}`}
            >
              <option value="" disabled>
                Select a country
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {e.country && (
              <p id="field-country-error" className="mt-1 text-xs text-red-600">
                {e.country}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className="space-y-2">
        <SubmitButton pendingLabel="Placing order…" className="w-full py-3">
          Place order
        </SubmitButton>
        <p className="text-center text-xs text-neutral-500">
          Your order will be saved with status “pending”. No payment is taken online yet.
        </p>
      </div>
    </form>
  );
}
