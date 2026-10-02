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
