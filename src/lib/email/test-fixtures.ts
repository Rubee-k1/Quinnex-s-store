import type { Order } from "@/lib/types/database";

export const order: Order = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: 1001,
  status: "pending",
  currency: "USD",
  subtotal_cents: 12500,
  shipping_cents: 0,
  total_cents: 12500,
  email: "ada@example.com",
  customer_name: "Ada <b>Lovelace</b>",
  phone: null,
  shipping_line1: "1 Marina Road",
  shipping_line2: null,
  shipping_city: "Lagos",
  shipping_state: "Lagos",
  shipping_postal_code: "100001",
  shipping_country: "NG",
  created_at: "2026-10-03T14:30:00Z",
  confirmation_email_status: "sending",
  confirmation_email_attempts: 1,
  confirmation_email_sent_at: null,
  confirmation_email_can_retry: false,
  items: [
    { id: "a", product_id: null, product_name: "Classic White Tee", product_slug: "classic-white-tee", unit_price_cents: 2800, quantity: 2, line_total_cents: 5600 },
    { id: "b", product_id: null, product_name: "Minimal Desk Lamp", product_slug: "minimal-desk-lamp", unit_price_cents: 6900, quantity: 1, line_total_cents: 6900 },
  ],
};
