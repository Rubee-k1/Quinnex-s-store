import { formatMoney } from "@/lib/money";
import { STORE_NAME } from "@/lib/store";
import type { Order } from "@/lib/types/database";
import type { EmailMessage } from "./mailgun";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Options = { supportEmail: string; siteUrl: string; timeZone?: string };

export function formatOrderDate(iso: string, timeZone = "UTC") {
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short", timeZone: tz }).format(new Date(iso)) +
    (tz === "UTC" ? " UTC" : "");
  try {
    return format(timeZone);
  } catch {
    return format("UTC"); // invalid STORE_TIMEZONE: fall back rather than fail the email
  }
}

/** Builds the order confirmation email. Every customer-supplied value is HTML-escaped. */
export function buildOrderConfirmationEmail(order: Order, { supportEmail, siteUrl, timeZone }: Options): EmailMessage {
  const money = (cents: number) => formatMoney(cents, order.currency);
  const name = order.customer_name?.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const date = formatOrderDate(order.created_at, timeZone);
  const countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(order.shipping_country) ?? order.shipping_country;
  const address = [
    name,
    order.shipping_line1,
    order.shipping_line2,
    [order.shipping_city, order.shipping_state, order.shipping_postal_code].filter(Boolean).join(", "),
    countryName,
  ].filter((l): l is string => Boolean(l));
  const shipping = order.shipping_cents === 0 ? "Free" : money(order.shipping_cents);
  const paymentNote =
    order.status === "pending" ? "Payment has not been taken yet. We'll contact you about payment and delivery." : null;

  const text = [
    `${STORE_NAME}`,
    "",
    greeting,
    "",
    `Thank you for your order! Here are your order details.`,
    "",
    `Order number: #${order.order_number}`,
    `Order date: ${date}`,
    "",
    "Items:",
    ...order.items.map((i) => `- ${i.product_name}: ${i.quantity} x ${money(i.unit_price_cents)} = ${money(i.line_total_cents)}`),
    "",
    `Subtotal: ${money(order.subtotal_cents)}`,
    `Shipping: ${shipping}`,
    `Total: ${money(order.total_cents)}`,
    "",
    "Shipping to:",
    ...address,
    "",
    ...(paymentNote ? [paymentNote, ""] : []),
    `Questions? Contact us at ${supportEmail} and quote order #${order.order_number}.`,
    "",
    `${STORE_NAME} — ${siteUrl}`,
  ].join("\n");

  const cell = "padding:8px 0;border-bottom:1px solid #eeeeee;font-size:14px;";
  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="${cell}">${escapeHtml(i.product_name)}</td>
        <td style="${cell}text-align:center">${i.quantity}</td>
        <td style="${cell}text-align:right">${escapeHtml(money(i.unit_price_cents))}</td>
        <td style="${cell}text-align:right">${escapeHtml(money(i.line_total_cents))}</td>
      </tr>`,
    )
    .join("");
  const th = "padding:8px 0;border-bottom:2px solid #171717;font-size:12px;text-transform:uppercase;color:#525252;";
  const sum = "padding:6px 0;font-size:14px;";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`Order #${order.order_number}`)}</title></head>
<body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#171717">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <p style="margin:0 0 16px;font-size:20px;font-weight:bold">${escapeHtml(STORE_NAME)}</p>
    <div style="background:#ffffff;border-radius:12px;padding:24px">
      <p style="margin:0 0 8px;font-size:16px">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#404040">Thank you for your order! Here are your order details.</p>
      <table role="presentation" style="width:100%;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:2px 0;color:#525252">Order number</td><td style="padding:2px 0;text-align:right;font-weight:bold">#${order.order_number}</td></tr>
        <tr><td style="padding:2px 0;color:#525252">Order date</td><td style="padding:2px 0;text-align:right">${escapeHtml(date)}</td></tr>
      </table>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${th}text-align:left">Product</th><th style="${th}text-align:center">Qty</th>
          <th style="${th}text-align:right">Unit price</th><th style="${th}text-align:right">Total</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table role="presentation" style="width:100%;margin-top:8px">
        <tr><td style="${sum}color:#525252">Subtotal</td><td style="${sum}text-align:right">${escapeHtml(money(order.subtotal_cents))}</td></tr>
        <tr><td style="${sum}color:#525252">Shipping</td><td style="${sum}text-align:right">${escapeHtml(shipping)}</td></tr>
        <tr><td style="${sum}font-weight:bold;font-size:16px">Total</td><td style="${sum}text-align:right;font-weight:bold;font-size:16px">${escapeHtml(money(order.total_cents))}</td></tr>
      </table>
      <p style="margin:24px 0 4px;font-size:14px;font-weight:bold">Shipping to</p>
      <p style="margin:0;font-size:14px;color:#404040;line-height:1.5">${address.map(escapeHtml).join("<br>")}</p>
      ${paymentNote ? `<p style="margin:16px 0 0;padding:12px;background:#fffbeb;border-radius:8px;font-size:13px;color:#92400e">${escapeHtml(paymentNote)}</p>` : ""}
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#525252;line-height:1.5">
      Questions about your order? Contact us at <a href="mailto:${escapeHtml(supportEmail)}" style="color:#171717">${escapeHtml(supportEmail)}</a>
      and quote order #${order.order_number}.<br>
      <a href="${escapeHtml(siteUrl)}" style="color:#171717">${escapeHtml(STORE_NAME)}</a>
    </p>
  </div>
</body></html>`;

  return {
    to: order.email,
    subject: `Your ${STORE_NAME} order #${order.order_number}`,
    text,
    html,
    tags: ["order-confirmation"],
    headers: { "Reply-To": supportEmail },
  };
}
