"use client";

import { useActionState } from "react";
import { resendOrderConfirmation } from "@/actions/checkout";
import { initialFormState } from "@/actions/state";
import { SubmitButton } from "./submit-button";

export function ResendConfirmationForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(resendOrderConfirmation, initialFormState);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton variant="secondary" pendingLabel="Sending…" className="py-1.5">
        Resend confirmation email
      </SubmitButton>
      {state.message && (
        <span role={state.status === "error" ? "alert" : "status"} className="text-sm">
          {state.message}
        </span>
      )}
    </form>
  );
}
