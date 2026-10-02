/**
 * Integration tests for order confirmation email tracking (Phase 3) against
 * a real PostgreSQL server, executed as the `anon` role.
 * Skipped when TEST_DATABASE_URL is not set.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const root = path.resolve(__dirname, "../..");
const newToken = () => randomBytes(32).toString("base64url");
const customer = { email: "ada@example.com", name: "Ada Lovelace", line1: "1 Marina Road", city: "Lagos", postal_code: "100001", country: "NG" };

describe.skipIf(!ADMIN_URL)("order confirmation email tracking (database)", () => {
  const dbName = `store_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;
  let dbUrl: string;

  async function asAnon<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      const res = await db.query(sql, params);
      await db.query("commit");
      return res.rows as T[];
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }

  async function placeOrder(token: string) {
    const [{ id }] = (await db.query("select id from public.products where slug = 'wool-beanie'")).rows;
    await asAnon("select public.add_to_cart($1, $2, 2)", [token, id]);
    const [{ f }] = await asAnon<{ f: string }>("select public.get_cart_fingerprint($1) as f", [token]);
    const [{ o }] = await asAnon<{ o: string }>("select public.place_order($1, $2, $3, $4) as o", [token, randomUUID(), f, customer]);
    return o;
  }
  const claim = async (token: string, id: string) =>
    (await asAnon<{ c: { order_number: number; email: string; items: unknown[] } | null }>(
      "select public.claim_order_confirmation_email($1, $2) as c",
      [token, id],
    ))[0].c;
  const record = async (token: string, id: string, sent: boolean, messageId: string | null, error: string | null) =>
    (await asAnon<{ r: boolean }>("select public.record_order_confirmation_email($1, $2, $3, $4, $5) as r", [token, id, sent, messageId, error]))[0].r;
  const state = async (id: string) =>
    (await db.query("select confirmation_email_status s, confirmation_email_attempts a, confirmation_email_last_error e, confirmation_email_message_id m, confirmation_email_sent_at t from public.orders where id = $1", [id])).rows[0];
  const attempts = async (id: string) =>
    (await db.query("select outcome, recipient, provider_message_id, error from public.order_email_attempts where order_id = $1 order by attempted_at", [id])).rows;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    dbUrl = url.toString();
    db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query(readFileSync(path.join(root, "tests/db/supabase-stub.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(dir).sort()) await db.query(readFileSync(path.join(dir, file), "utf8"));
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await db.query("delete from public.order_email_attempts; delete from public.order_items; delete from public.orders; delete from public.cart_items; delete from public.carts;");
    await db.query(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  });

  it("new orders start with a pending confirmation email", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    expect(await state(id)).toMatchObject({ s: "pending", a: 0 });
    const [{ o }] = await asAnon<{ o: Record<string, unknown> }>("select public.get_order($1, $2) as o", [token, id]);
    expect(o).toMatchObject({ confirmation_email_status: "pending", confirmation_email_can_retry: false });
  });

  it("claims once and returns the order with its items for building the email", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    const claimed = await claim(token, id);
    expect(claimed).toMatchObject({ email: "ada@example.com", order_number: expect.any(Number) });
    expect(claimed!.items).toHaveLength(1);
    expect(await state(id)).toMatchObject({ s: "sending", a: 1 });
    // A duplicate submission can't claim it again while it's in flight.
    expect(await claim(token, id)).toBeNull();
  });

  it("records a successful send and logs the attempt", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    await claim(token, id);
    expect(await record(token, id, true, "<20261004.abc@mg.example.com>", null)).toBe(true);
    const s = await state(id);
    expect(s).toMatchObject({ s: "sent", a: 1, e: null, m: "<20261004.abc@mg.example.com>" });
    expect(s.t).not.toBeNull();
    expect(await attempts(id)).toEqual([
      { outcome: "sent", recipient: "ada@example.com", provider_message_id: "<20261004.abc@mg.example.com>", error: null },
    ]);
    // Already sent: never claimed again (no duplicate emails).
    expect(await claim(token, id)).toBeNull();
  });

  it("records a failure, keeps the order intact, and allows a later retry", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    await claim(token, id);
    expect(await record(token, id, false, null, "Mailgun responded 401: Forbidden")).toBe(true);
    expect(await state(id)).toMatchObject({ s: "failed", a: 1, e: "Mailgun responded 401: Forbidden" });

    // The order itself is untouched.
    const order = (await db.query("select status, total_cents from public.orders where id = $1", [id])).rows[0];
    expect(order).toEqual({ status: "pending", total_cents: 4800 });
    const [{ o }] = await asAnon<{ o: Record<string, unknown> }>("select public.get_order($1, $2) as o", [token, id]);
    expect(o).toMatchObject({ confirmation_email_status: "failed", confirmation_email_can_retry: true });

    // Retry succeeds and both attempts are logged.
    expect(await claim(token, id)).not.toBeNull();
    await record(token, id, true, "<id2@mg>", null);
    expect(await state(id)).toMatchObject({ s: "sent", a: 2, e: null });
    expect((await attempts(id)).map((a) => a.outcome)).toEqual(["failed", "sent"]);
  });

  it("caps delivery attempts", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    for (let i = 0; i < 5; i++) {
      expect(await claim(token, id)).not.toBeNull();
      await record(token, id, false, null, `fail ${i}`);
    }
    expect(await claim(token, id)).toBeNull();
    expect(await state(id)).toMatchObject({ s: "failed", a: 5 });
    const [{ o }] = await asAnon<{ o: Record<string, unknown> }>("select public.get_order($1, $2) as o", [token, id]);
    expect(o).toMatchObject({ confirmation_email_can_retry: false });
  });

  it("concurrent claims (duplicate checkout submissions) yield exactly one sender", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const c = new Client({ connectionString: dbUrl });
        await c.connect();
        try {
          await c.query("set role anon");
          return (await c.query("select public.claim_order_confirmation_email($1, $2) as c", [token, id])).rows[0].c;
        } finally {
          await c.end();
        }
      }),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await state(id)).toMatchObject({ s: "sending", a: 1 });
  });

  it("recovers a stale in-flight claim", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    await claim(token, id);
    await db.query("update public.orders set confirmation_email_claimed_at = now() - interval '5 minutes' where id = $1", [id]);
    expect(await claim(token, id)).not.toBeNull();
    expect(await state(id)).toMatchObject({ s: "sending", a: 2 });
  });

  it("ignores results without a claim and rejects other browsers", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    expect(await record(token, id, true, "x", null)).toBe(false); // nothing claimed
    expect(await state(id)).toMatchObject({ s: "pending", a: 0 });
    expect(await attempts(id)).toEqual([]);

    const stranger = newToken();
    expect(await claim(stranger, id)).toBeNull();
    await claim(token, id);
    expect(await record(stranger, id, true, "x", null)).toBe(false);
    expect(await state(id)).toMatchObject({ s: "sending" });
    await expect(claim("bad", id)).rejects.toThrow(/INVALID_CART_TOKEN/);
  });

  it("gives visitors no direct access to the attempt log", async () => {
    await expect(asAnon("select * from public.order_email_attempts")).rejects.toThrow(/permission denied/);
    await expect(asAnon("update public.orders set confirmation_email_status = 'sent'")).rejects.toThrow(/permission denied/);
  });

  it("truncates very long error messages", async () => {
    const token = newToken();
    const id = await placeOrder(token);
    await claim(token, id);
    await record(token, id, false, null, "x".repeat(5000));
    expect((await state(id)).e).toHaveLength(500);
  });
});
