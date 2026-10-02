import { describe, expect, it } from "vitest";
import { cartItemSchema, productIdSchema, productSlugSchema, quantitySchema } from "./validation";

const ID = "3f0c7d3e-2a59-4c51-9a3e-6c3f7d1d2b10";

describe("validation", () => {
  it("accepts UUID product ids and rejects anything else", () => {
    expect(productIdSchema.safeParse(ID).success).toBe(true);
    for (const bad of ["", "123", "not-a-uuid", "'; drop table products; --", null, undefined]) {
      expect(productIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("coerces and bounds quantities", () => {
    expect(quantitySchema.parse("3")).toBe(3);
    for (const bad of ["0", "100", "-1", "1.5", "abc"]) expect(quantitySchema.safeParse(bad).success).toBe(false);
    expect(cartItemSchema.parse({ productId: ID, quantity: "2" })).toEqual({ productId: ID, quantity: 2 });
  });

  it("only accepts well-formed product slugs", () => {
    expect(productSlugSchema.safeParse("classic-white-tee").success).toBe(true);
    for (const bad of ["Classic", "a--b", "-a", "a b", "../etc", ID.toUpperCase()]) {
      expect(productSlugSchema.safeParse(bad).success).toBe(false);
    }
  });
});
