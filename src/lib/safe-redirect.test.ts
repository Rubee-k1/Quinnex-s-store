import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/account", "/account"],
    ["/products/tee?x=1", "/products/tee?x=1"],
    ["/orders/abc", "/orders/abc"],
  ])("allows relative path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/a\\b", "javascript:alert(1)", "", null, undefined, "/a\nb", "x".repeat(600)])(
    "rejects %s",
    (input) => {
      expect(safeRedirectPath(input)).toBe("/");
    },
  );
});
