import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats minor units", () => {
    expect(formatMoney(2800, "USD")).toBe("$28.00");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
  });
  it("respects zero-decimal currencies", () => {
    expect(formatMoney(500, "JPY")).toBe("¥500");
  });
});
