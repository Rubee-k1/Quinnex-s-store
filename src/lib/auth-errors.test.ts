import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("authErrorMessage", () => {
  it("explains known errors and falls back for unknown ones", () => {
    expect(authErrorMessage("access_denied")).toMatch(/cancelled/);
    expect(authErrorMessage("callback")).toMatch(/couldn't complete/);
    expect(authErrorMessage("<script>")).toBe("Something went wrong while signing in. Please try again.");
    expect(authErrorMessage(null)).toBeNull();
  });
});
