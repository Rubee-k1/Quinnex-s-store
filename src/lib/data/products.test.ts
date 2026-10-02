import { describe, expect, it } from "vitest";
import { escapeSearchTerm } from "./products";

describe("escapeSearchTerm", () => {
  it("escapes ILIKE wildcards and strips PostgREST filter syntax", () => {
    expect(escapeSearchTerm("100%_off")).toBe("100\\%\\_off");
    expect(escapeSearchTerm("a,name.eq.x)")).toBe("a name.eq.x ");
    expect(escapeSearchTerm("back\\slash")).toBe("back\\\\slash");
  });
});
