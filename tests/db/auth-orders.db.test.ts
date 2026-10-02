/**
 * Phase 4 integration tests: profiles and per-user order access under RLS,
 * against a real PostgreSQL server. Requests run as `authenticated` with the
 * JWT `sub` claim set exactly as PostgREST does for a signed-in Supabase user.
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

describe.skipIf(!ADMIN_URL)("auth: profiles and own-order access (database)", () => {
  const dbName = `store_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;
  const ALICE = randomUUID();
  const BOB = randomUUID();

  /** Run SQL as a signed-in user (role authenticated + sub claim) or as anon. */
  async function as<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []) {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await db.query(userId ? "set local role authenticated" : "set local role anon");
      const res = await db.query(sql, params);
      await db.query("commit");
      return res.rows as T[];
    } catch (err) {
      await db.query("rollback");
      throw err;
    }
  }

  async function placeOrder(userId: string | null, token: string, email: string) {
    const [{ id }] = (await db.query("select id from public.products where slug = 'wool-beanie'")).rows;
    await as(userId, "select public.add_to_cart($1, $2, 1)", [token, id]);
    const [{ f }] = await as<{ f: string }>(userId, "select public.get_cart_fingerprint($1) as f", [token]);
    const customer = { email, name: "Test", line1: "1 Road", city: "Lagos", postal_code: "100001", country: "NG" };
    const [{ o }] = await as<{ o: string }>(userId, "select public.place_order($1, $2, $3, $4) as o", [token, randomUUID(), f, customer]);
    return o;
  }

  const ORDER_COLUMNS = "id, order_number, user_id, status, total_cents, email";

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(readFileSync(path.join(root, "tests/db/supabase-stub.sql"), "utf8"));
    // A user that exists BEFORE the migration, to test the profile backfill.
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'early@example.com', '{\"name\":\"Early Bird\"}')", [
      "00000000-0000-4000-8000-0000000000e1",
    ]);
    const dir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(dir).sort()) await db.query(readFileSync(path.join(dir, file), "utf8"));
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values
        ($1, 'alice@example.com', '{"full_name":"Alice Google","avatar_url":"https://lh3.googleusercontent.com/a"}'),
        ($2, 'bob@example.com', '{"name":"Bob Google","picture":"https://lh3.googleusercontent.com/b"}')`,
      [ALICE, BOB],
    );
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

  describe("profiles", () => {
    it("are created from Google metadata when a user signs up, keyed by the auth user id", async () => {
      const rows = (await db.query("select id, email, full_name, avatar_url from public.profiles where id = any($1) order by email", [[ALICE, BOB]])).rows;
      expect(rows).toEqual([
        { id: ALICE, email: "alice@example.com", full_name: "Alice Google", avatar_url: "https://lh3.googleusercontent.com/a" },
        { id: BOB, email: "bob@example.com", full_name: "Bob Google", avatar_url: "https://lh3.googleusercontent.com/b" },
      ]);
    });

    it("are backfilled for users that existed before the migration", async () => {
      const [row] = (await db.query("select full_name from public.profiles where email = 'early@example.com'")).rows;
      expect(row.full_name).toBe("Early Bird");
    });

    it("are readable only by their owner, and only the name is editable", async () => {
      expect(await as(ALICE, "select email from public.profiles")).toEqual([{ email: "alice@example.com" }]);
      expect(await as(null, "select 1 from public.profiles").catch((e) => e.message)).toMatch(/permission denied/);
      await as(ALICE, "update public.profiles set full_name = 'Alice A.' where id = $1", [ALICE]);
      expect((await db.query("select full_name from public.profiles where id = $1", [ALICE])).rows[0].full_name).toBe("Alice A.");
      // Can't touch someone else's profile, or change email.
      const res = await as(ALICE, "update public.profiles set full_name = 'hacked' where id = $1 returning id", [BOB]);
      expect(res).toEqual([]);
      await expect(as(ALICE, "update public.profiles set email = 'x@y.z' where id = $1", [ALICE])).rejects.toThrow(/permission denied/);
    });
  });

  describe("orders", () => {
    it("records the auth user id on orders placed while signed in", async () => {
      const id = await placeOrder(ALICE, newToken(), "alice@example.com");
      expect((await db.query("select user_id from public.orders where id = $1", [id])).rows[0].user_id).toBe(ALICE);
    });

    it("lets a user list only their own orders and items", async () => {
      const a1 = await placeOrder(ALICE, newToken(), "alice@example.com");
      const a2 = await placeOrder(ALICE, newToken(), "alice@example.com");
      const b1 = await placeOrder(BOB, newToken(), "bob@example.com");
      await placeOrder(null, newToken(), "guest@example.com");

      const aliceOrders = await as<{ id: string }>(ALICE, `select ${ORDER_COLUMNS} from public.orders order by created_at`);
      expect(aliceOrders.map((o) => o.id).sort()).toEqual([a1, a2].sort());
      const bobOrders = await as<{ id: string }>(BOB, `select ${ORDER_COLUMNS} from public.orders`);
      expect(bobOrders.map((o) => o.id)).toEqual([b1]);

      const aliceItems = await as<{ order_id: string }>(ALICE, "select order_id from public.order_items");
      expect(new Set(aliceItems.map((i) => i.order_id))).toEqual(new Set([a1, a2]));
    });

    it("never returns another user's order, even by id", async () => {
      const b1 = await placeOrder(BOB, newToken(), "bob@example.com");
      expect(await as(ALICE, `select ${ORDER_COLUMNS} from public.orders where id = $1`, [b1])).toEqual([]);
      expect(await as(ALICE, "select * from public.order_items where order_id = $1", [b1])).toEqual([]);
      // get_order (used by the order page) also refuses without Bob's cart token.
      const [{ o }] = await as<{ o: unknown }>(ALICE, "select public.get_order(null, $1) as o", [b1]);
      expect(o).toBeNull();
      // ...but returns it to Bob on any device (no cart token needed).
      const [{ o: mine }] = await as<{ o: { id: string } | null }>(BOB, "select public.get_order(null, $1) as o", [b1]);
      expect(mine?.id).toBe(b1);
    });

    it("gives anonymous visitors no order access", async () => {
      await placeOrder(ALICE, newToken(), "alice@example.com");
      await expect(as(null, `select ${ORDER_COLUMNS} from public.orders`)).rejects.toThrow(/permission denied/);
      await expect(as(null, "select * from public.order_items")).rejects.toThrow(/permission denied/);
    });

    it("hides internal columns from signed-in users", async () => {
      await placeOrder(ALICE, newToken(), "alice@example.com");
      for (const col of ["cart_token_hash", "idempotency_key", "confirmation_email_last_error", "confirmation_email_claimed_at"]) {
        await expect(as(ALICE, `select ${col} from public.orders`)).rejects.toThrow(/permission denied/);
      }
      await expect(as(ALICE, "select * from public.orders")).rejects.toThrow(/permission denied/);
    });

    it("does not let users modify or create orders directly", async () => {
      const a1 = await placeOrder(ALICE, newToken(), "alice@example.com");
      await expect(as(ALICE, "update public.orders set total_cents = 1 where id = $1", [a1])).rejects.toThrow(/permission denied/);
      await expect(as(ALICE, "update public.orders set user_id = $1 where id = $2", [BOB, a1])).rejects.toThrow(/permission denied/);
      await expect(as(ALICE, "delete from public.orders where id = $1", [a1])).rejects.toThrow(/permission denied/);
      await expect(as(ALICE, "delete from public.order_items")).rejects.toThrow(/permission denied/);
    });
  });

  describe("linking guest orders at sign-in", () => {
    it("links guest orders from the same browser with the same email", async () => {
      const token = newToken();
      const guestOrder = await placeOrder(null, token, "Alice@Example.com");
      const [{ n }] = await as<{ n: number }>(ALICE, "select public.link_guest_orders_to_user($1) as n", [token]);
      expect(n).toBe(1);
      expect((await as<{ id: string }>(ALICE, "select id from public.orders")).map((o) => o.id)).toEqual([guestOrder]);
    });

    it("does not link orders with a different email (shared computer)", async () => {
      const token = newToken();
      await placeOrder(null, token, "someone-else@example.com");
      const [{ n }] = await as<{ n: number }>(ALICE, "select public.link_guest_orders_to_user($1) as n", [token]);
      expect(n).toBe(0);
      expect(await as(ALICE, "select id from public.orders")).toEqual([]);
    });

    it("does not link orders from another browser, or orders that already belong to someone", async () => {
      await placeOrder(null, newToken(), "alice@example.com"); // other browser
      const token = newToken();
      await placeOrder(BOB, token, "alice@example.com"); // Bob's order using Alice's email
      const [{ n }] = await as<{ n: number }>(ALICE, "select public.link_guest_orders_to_user($1) as n", [token]);
      expect(n).toBe(0);
    });

    it("requires a signed-in user", async () => {
      await expect(as(null, "select public.link_guest_orders_to_user($1)", [newToken()])).rejects.toThrow(/permission denied/);
    });
  });
});
