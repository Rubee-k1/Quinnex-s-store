import { describe, expect, it } from "vitest";
import { describeDbError } from "./db-errors";

describe("describeDbError", () => {
  it("maps known cart function errors to friendly messages", () => {
    expect(describeDbError({ message: "OUT_OF_STOCK" })).toBe("Sorry, this product is out of stock.");
    expect(describeDbError({ message: "INSUFFICIENT_STOCK" })).toMatch(/isn't enough stock/);
    expect(describeDbError({ message: "PRODUCT_NOT_FOUND" })).toMatch(/no longer available/);
    expect(describeDbError({ message: "ITEM_NOT_IN_CART" })).toMatch(/no longer in your cart/);
  });
  it("never leaks raw database messages", () => {
    expect(describeDbError({ message: 'relation "secret_table" does not exist' })).toBe("Something went wrong. Please try again.");
    expect(describeDbError(null)).toBe("Something went wrong. Please try again.");
  });
});

describe("describeDbError (checkout)", () => {
  it("explains checkout failures", () => {
    expect(describeDbError({ message: "CART_EMPTY" })).toBe("Your cart is empty.");
    expect(describeDbError({ message: "CART_CHANGED" })).toMatch(/cart changed/);
    expect(describeDbError({ message: "INSUFFICIENT_STOCK: Lamp (2 available)" })).toBe(
      "Not enough stock for Lamp (2 available). Please update the quantity in your cart.",
    );
    expect(describeDbError({ message: "PRODUCT_UNAVAILABLE: Beanie" })).toMatch(/^Beanie is no longer available/);
    expect(describeDbError({ message: "IDEMPOTENCY_CONFLICT" })).toMatch(/expired/);
  });
});
