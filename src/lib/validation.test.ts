import { describe, expect, it } from "vitest";
import { cartItemSchema, checkoutSchema, fieldErrors, productIdSchema, productSlugSchema, quantitySchema } from "./validation";

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

describe("checkoutSchema", () => {
  const valid = {
    idempotencyKey: ID,
    cartFingerprint: "0123456789abcdef0123456789abcdef",
    email: "  Ada@Example.COM ",
    name: " Ada Lovelace ",
    phone: "",
    line1: "1 Marina Road",
    line2: "",
    city: "Lagos",
    state: "",
    postalCode: "100001",
    country: "ng",
  };

  it("normalises valid input", () => {
    const r = checkoutSchema.parse(valid);
    expect(r).toMatchObject({ email: "ada@example.com", name: "Ada Lovelace", country: "NG" });
    expect(r.phone).toBeUndefined();
    expect(r.line2).toBeUndefined();
  });

  it("reports each invalid or missing field with a friendly message", () => {
    const rest: Partial<typeof valid> = { ...valid, email: "nope", name: " ", phone: "abc" };
    delete rest.country;
    const r = checkoutSchema.safeParse(rest);
    expect(fieldErrors(r.error!)).toEqual({
      email: "Enter a valid email address",
      name: "Full name is required",
      phone: "Enter a valid phone number",
      country: "Select a country",
    });
  });

  it("says an empty email is required", () => {
    expect(fieldErrors(checkoutSchema.safeParse({ ...valid, email: "  " }).error!).email).toBe("Email is required");
  });

  it("has no price, total or quantity fields", () => {
    expect(Object.keys(checkoutSchema.shape).join(",")).not.toMatch(/price|total|quantity/i);
  });
});
