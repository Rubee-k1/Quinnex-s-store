import { describe, expect, it } from "vitest";
import type { CartRow } from "@/lib/types/database";
import { buildCart } from "./cart";

const row = (overrides: Partial<CartRow>): CartRow => ({
  product_id: "p",
  quantity: 1,
  slug: "tee",
  name: "Tee",
  price_cents: 2800,
  currency: "USD",
  image_url: null,
  stock: 10,
  is_active: true,
  added_at: "2026-10-02T00:00:00Z",
  ...overrides,
});

describe("buildCart", () => {
  it("totals lines and counts items", () => {
    const cart = buildCart([row({ quantity: 2 }), row({ product_id: "q", price_cents: 6900 })]);
    expect(cart.itemCount).toBe(3);
    expect(cart.subtotalCents).toBe(2 * 2800 + 6900);
    expect(cart.currency).toBe("USD");
    expect(cart.hasIssues).toBe(false);
    expect(cart.lines[0]).toMatchObject({ lineTotalCents: 5600, maxQuantity: 10, issue: null });
  });

  it("flags products whose stock dropped below the cart quantity", () => {
    const cart = buildCart([row({ quantity: 5, stock: 2 })]);
    expect(cart.lines[0]).toMatchObject({ issue: "insufficient_stock", maxQuantity: 5 });
    expect(cart.hasIssues).toBe(true);
  });

  it("excludes unavailable products from the subtotal", () => {
    const cart = buildCart([row({ is_active: false, quantity: 2 }), row({ product_id: "q" })]);
    expect(cart.lines[0].issue).toBe("unavailable");
    expect(cart.subtotalCents).toBe(2800);
    expect(cart.itemCount).toBe(3);
  });

  it("caps the selectable quantity at 99", () => {
    expect(buildCart([row({ stock: 500 })]).lines[0].maxQuantity).toBe(99);
  });

  it("handles an empty cart", () => {
    expect(buildCart([])).toEqual({ lines: [], itemCount: 0, subtotalCents: 0, currency: null, hasIssues: false });
  });
});
