import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// `server-only` throws when imported outside a React Server environment.
// Tests exercise server modules directly, so neutralise it here.
vi.mock("server-only", () => ({}));
