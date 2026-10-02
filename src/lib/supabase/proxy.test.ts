import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./proxy";

describe("isProtectedPath", () => {
  it.each(["/account", "/account/", "/account/orders"])("protects %s", (p) => expect(isProtectedPath(p)).toBe(true));
  it.each(["/", "/products", "/cart", "/checkout", "/login", "/accounts", "/orders/1"])("leaves %s public", (p) =>
    expect(isProtectedPath(p)).toBe(false),
  );
});
