import { beforeEach, describe, expect, it, vi } from "vitest";
import { order } from "./test-fixtures";

const TOKEN = "t".repeat(43);
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("./mailgun", () => ({ sendMailgunEmail: mocks.send }));

const { sendOrderConfirmation } = await import("./send-order-confirmation");

/** rpc mock: claim returns `claimed`; record succeeds (or fails if recordError set). */
function setupRpc(claimed: unknown, { claimError, recordError }: { claimError?: string; recordError?: string } = {}) {
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === "claim_order_confirmation_email") return claimError ? { data: null, error: { message: claimError } } : { data: claimed, error: null };
    if (fn === "record_order_confirmation_email") return recordError ? { data: null, error: { message: recordError } } : { data: true, error: null };
    throw new Error(`unexpected rpc ${fn}`);
  });
}
const recordCalls = () => mocks.rpc.mock.calls.filter(([fn]) => fn === "record_order_confirmation_email").map(([, args]) => args);

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.send.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("MAILGUN_API_KEY", "test-mailgun-key-not-real-0002");
  vi.stubEnv("MAILGUN_DOMAIN", "mg.quinnex.com");
  vi.stubEnv("MAILGUN_FROM_EMAIL", "orders@mg.quinnex.com");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://quinnex-s-store.vercel.app");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendOrderConfirmation", () => {
  it("successful order + successful email: claims, sends, and records 'sent'", async () => {
    setupRpc(order);
    mocks.send.mockResolvedValue({ id: "<msg-1@mg>" });
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "sent", messageId: "<msg-1@mg>" });

    expect(mocks.rpc).toHaveBeenCalledWith("claim_order_confirmation_email", { p_token: TOKEN, p_order_id: order.id });
    const [config, message] = mocks.send.mock.calls[0];
    expect(config).toMatchObject({ domain: "mg.quinnex.com", from: "Quinnex Store <orders@mg.quinnex.com>" });
    expect(message).toMatchObject({ to: "ada@example.com", subject: "Your Quinnex Store order #1001" });
    expect(recordCalls()).toEqual([{ p_token: TOKEN, p_order_id: order.id, p_sent: true, p_message_id: "<msg-1@mg>", p_error: null }]);
  });

  it("successful order + Mailgun failure: records 'failed' with the reason and does not throw", async () => {
    setupRpc(order);
    mocks.send.mockRejectedValue(new Error("Mailgun responded 502: bad gateway"));
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "failed", error: "Mailgun responded 502: bad gateway" });
    expect(recordCalls()).toEqual([{ p_token: TOKEN, p_order_id: order.id, p_sent: false, p_message_id: null, p_error: "Mailgun responded 502: bad gateway" }]);
  });

  it("invalid Mailgun configuration (missing key): never calls Mailgun, records the reason", async () => {
    vi.stubEnv("MAILGUN_API_KEY", "");
    setupRpc(order);
    const r = await sendOrderConfirmation(TOKEN, order.id);
    expect(r).toEqual({ status: "failed", error: "Mailgun is not configured: missing MAILGUN_API_KEY" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(recordCalls()[0]).toMatchObject({ p_sent: false, p_error: "Mailgun is not configured: missing MAILGUN_API_KEY" });
  });

  it("invalid Mailgun configuration (bad from address)", async () => {
    vi.stubEnv("MAILGUN_FROM_EMAIL", "orders-at-quinnex");
    setupRpc(order);
    const r = await sendOrderConfirmation(TOKEN, order.id);
    expect(r.status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("missing customer email: does not send, records a failure", async () => {
    setupRpc({ ...order, email: "" });
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "failed", error: "Order has no valid customer email address" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(recordCalls()[0]).toMatchObject({ p_sent: false, p_error: "Order has no valid customer email address" });
  });

  it("duplicate submission: an already-claimed or sent order is skipped without sending", async () => {
    setupRpc(null);
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "skipped" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(recordCalls()).toEqual([]);
  });

  it("database problems never throw", async () => {
    setupRpc(null, { claimError: "connection refused" });
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "failed", error: "Could not claim email send: connection refused" });

    setupRpc(order, { recordError: "timeout" });
    mocks.send.mockResolvedValue({ id: "<x>" });
    expect(await sendOrderConfirmation(TOKEN, order.id)).toEqual({ status: "sent", messageId: "<x>" });
  });

  it("never logs the API key", async () => {
    setupRpc(order);
    mocks.send.mockRejectedValue(new Error("Mailgun responded 401 (check MAILGUN_API_KEY): Forbidden"));
    await sendOrderConfirmation(TOKEN, order.id);
    const logged = JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.info).mock.calls]);
    expect(logged).not.toContain("test-mailgun-key-not-real-0002");
  });
});
