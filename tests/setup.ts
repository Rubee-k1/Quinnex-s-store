import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// `server-only` throws when imported outside a React Server environment.
// Tests exercise server modules directly, so neutralise it here.
vi.mock("server-only", () => ({}));

// Testing Library only auto-cleans up when Vitest globals are enabled.
afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
