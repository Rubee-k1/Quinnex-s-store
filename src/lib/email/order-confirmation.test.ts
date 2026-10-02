import { describe, expect, it } from "vitest";
import { buildOrderConfirmationEmail, formatOrderDate } from "./order-confirmation";
import { order } from "./test-fixtures";

const opts = { supportEmail: "help@quinnex.com", siteUrl: "https://quinnex-s-store.vercel.app", timeZone: "UTC" };

describe("buildOrderConfirmationEmail", () => {
  const email = buildOrderConfirmationEmail(order, opts);

  it("is addressed to the customer with the order number in the subject", () => {
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Your Quinnex Store order #1001");
    expect(email.headers).toEqual({ "Reply-To": "help@quinnex.com" });
  });

  it.each([
    ["shop name", "Quinnex Store"],
    ["customer name", "Hi Ada <b>Lovelace</b>,"],
    ["order number", "Order number: #1001"],
    ["order date", "Order date: October 3, 2026 at 2:30 PM UTC"],
    ["product, quantity, unit price and item total", "- Classic White Tee: 2 x $28.00 = $56.00"],
    ["second item", "- Minimal Desk Lamp: 1 x $69.00 = $69.00"],
    ["subtotal", "Subtotal: $125.00"],
    ["total", "Total: $125.00"],
    ["support contact", "Contact us at help@quinnex.com"],
  ])("plain-text version contains the %s", (_label, expected) => {
    expect(email.text).toContain(expected);
  });

  it("HTML version contains the same details", () => {
    for (const s of ["Quinnex Store", "#1001", "October 3, 2026", "Classic White Tee", ">2<", "$28.00", "$56.00", "$125.00", "mailto:help@quinnex.com"]) {
      expect(email.html).toContain(s);
    }
  });

  it("escapes customer-supplied values in HTML", () => {
    expect(email.html).not.toContain("<b>Lovelace</b>");
    expect(email.html).toContain("Ada &lt;b&gt;Lovelace&lt;/b&gt;");
  });

  it("greets generically when no customer name is available", () => {
    const anon = buildOrderConfirmationEmail({ ...order, customer_name: "" }, opts);
    expect(anon.text).toContain("Hi,\n");
    expect(anon.html).toContain(">Hi,<");
  });

  it("mentions that payment is pending", () => {
    expect(email.text).toContain("Payment has not been taken yet");
  });

  it("falls back to UTC for an invalid time zone", () => {
    expect(formatOrderDate(order.created_at, "Not/AZone")).toBe("October 3, 2026 at 2:30 PM UTC");
    expect(formatOrderDate(order.created_at, "Africa/Lagos")).toBe("October 3, 2026 at 3:30 PM");
  });
});
