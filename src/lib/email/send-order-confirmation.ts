import "server-only";
import { z } from "zod";
import { getMailgunConfig, getSiteUrl } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types/database";
import { sendMailgunEmail } from "./mailgun";
import { buildOrderConfirmationEmail } from "./order-confirmation";

export type ConfirmationEmailResult =
  | { status: "sent"; messageId: string }
  | { status: "failed"; error: string }
  /** Already sent, being sent by another request, attempts exhausted, or not this visitor's order. */
  | { status: "skipped" };

const recipientSchema = z.email();

/**
 * Sends the confirmation email for an order that has ALREADY been committed,
 * and records the outcome. Never throws: email problems must never affect the
 * order or the customer's successful checkout.
 *
 * Flow: claim (atomic; prevents duplicate sends) → load order + items → build →
 * send via Mailgun → record outcome + attempt log.
 */
export async function sendOrderConfirmation(cartToken: string, orderId: string): Promise<ConfirmationEmailResult> {
  const supabase = await createClient();
  const log = (level: "info" | "error", msg: string, extra?: string) =>
    console[level](`[order-email] order=${orderId} ${msg}${extra ? `: ${extra}` : ""}`);

  // 1–2. Claim the send and retrieve the persisted order with its items.
  let order: Order | null;
  try {
    const { data, error } = await supabase.rpc("claim_order_confirmation_email", { p_token: cartToken, p_order_id: orderId });
    if (error) throw new Error(error.message);
    order = (data as Order | null) ?? null;
  } catch (err) {
    const error = `Could not claim email send: ${(err as Error).message}`;
    log("error", "claim failed", error);
    return { status: "failed", error };
  }
  if (!order) {
    log("info", "skipped (already sent, in progress, or not claimable)");
    return { status: "skipped" };
  }

  const record = async (sent: boolean, messageId: string | null, error: string | null) => {
    try {
      const { error: rpcError } = await supabase.rpc("record_order_confirmation_email", {
        p_token: cartToken,
        p_order_id: orderId,
        p_sent: sent,
        p_message_id: messageId,
        p_error: error,
      });
      if (rpcError) throw new Error(rpcError.message);
    } catch (err) {
      // The claim expires after 2 minutes, so a retry remains possible.
      log("error", "could not record email outcome", (err as Error).message);
    }
  };

  const fail = async (error: string): Promise<ConfirmationEmailResult> => {
    log("error", "not sent", error);
    await record(false, null, error);
    return { status: "failed", error };
  };

  try {
    // Defensive: the database requires an email, but never send without a valid recipient.
    if (!order.email || !recipientSchema.safeParse(order.email).success) {
      return await fail("Order has no valid customer email address");
    }

    const config = getMailgunConfig();
    if (!config.ok) return await fail(config.error);

    // 3. Build.
    const message = buildOrderConfirmationEmail(order, {
      supportEmail: config.config.supportEmail,
      siteUrl: getSiteUrl(),
      timeZone: process.env.STORE_TIMEZONE || "UTC",
    });

    // 4. Send.
    const { id } = await sendMailgunEmail(config.config, message);

    // 5. Record.
    await record(true, id || null, null);
    log("info", `sent to ${order.email.replace(/^(.).*(@.*)$/, "$1***$2")}`, id || undefined);
    return { status: "sent", messageId: id };
  } catch (err) {
    return await fail((err as Error).message || "Unknown email error");
  }
}
