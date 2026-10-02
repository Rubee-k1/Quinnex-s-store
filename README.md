# Quinnex Store

A Next.js (App Router) online shop backed by Supabase. Built to deploy on Vercel.

**Current scope: Phases 1–4.** The app has a catalogue, product pages, search,
category filtering, a persistent guest cart (Phase 1), and checkout with orders
saved in Supabase (Phase 2), order confirmation emails via Mailgun (Phase 3), and
Google sign-in with "My orders" (Phase 4). Payments are a later phase. Orders are saved with status `pending` and no payment is taken.

## Features

- Homepage with categories and latest arrivals
- Product listing with search, category filter and pagination
- Product detail pages: image, name, description, price, stock status
- Add to cart, a header cart icon with item count, a cart page with −/+ quantity
  controls, item removal and an empty state
- Guest cart persisted in Supabase for 30 days per browser, with no sign-in required
- Loading skeletons, empty states, error boundary with retry, 404 for unknown
  products and categories, out-of-stock handling, responsive mobile and desktop layout

## Architecture

```
src/
  app/
    page.tsx                    Homepage
    products/(catalog)/         Listing + search + filter (with loading skeleton)
    products/[slug]/            Product detail (404 for unknown/invalid slugs)
    cart/                       Cart page
    error.tsx, not-found.tsx    Error and 404 states
  actions/cart.ts               Server actions: add / set quantity / remove (zod-validated)
  components/                   UI components
  lib/
    supabase/server.ts          Server-side Supabase client (anon key, RLS enforced)
    data/                       products.ts, cart.ts
    cart-token.ts               Guest cart cookie
supabase/
  migrations/                   Schema, RLS and cart functions
  seed.sql                      Sample categories and products
tests/
  db/                           SQL integration tests against real Postgres
  e2e/                          Playwright end-to-end tests
```

### Data model

- `categories`: slug, name, description, sort order
- `products`: slug, name, description, `category_id`, `price_cents` (integer
  minor units), currency, image URL, stock, `is_active`
- `carts` and `cart_items`: guest carts

### Checkout and orders (Phase 2)

- `orders`: order number, `user_id` (only when signed in, a later phase), customer
  email, name and phone, shipping address, `subtotal_cents`, `shipping_cents`,
  `total_cents`, `status` (`pending` / `paid` / `fulfilled` / `cancelled`), `created_at`
- `order_items`: product ID, product name and slug snapshot, unit price snapshot,
  quantity, line total

Orders are created only by `place_order()`, in one transaction:

1. **Duplicate protection.** Each checkout page carries a fresh `idempotency_key`. A repeated
   submission of the same checkout (double click, retry, replay) returns the
   existing order instead of creating another. Submissions for one cart are
   serialised with an advisory lock, and the key is unique in the database.
2. **Cart-change check.** The checkout page also sends a digest of the cart it showed (items,
   quantities, prices and availability). If the cart changed in the meantime, the order is
   refused (`CART_CHANGED`) and the page re-renders the current summary.
3. **Locking and validation.** The function locks the product rows, then checks that every product is still active
   and has enough stock.
4. **Server-side prices.** Every price and total is recalculated from `products`. Nothing price-related is
   accepted from the browser, and the form has no price fields.
5. **Writes.** It writes the order and its items, decrements stock and empties the cart.
   Any failure rolls the whole transaction back, so no partial orders are possible.

Visitors cannot read or write `orders` or `order_items` directly. `get_order()` returns
an order only to the browser (cart cookie) that placed it, so other visitors get a 404.

### Order confirmation emails (Phase 3)

After `place_order()` commits, the checkout action calls `sendOrderConfirmation()`
(`src/lib/email/`, server-only):

1. `claim_order_confirmation_email()` atomically marks the order's email
   as `sending` and returns the order with its items. It returns nothing if the email was already
   sent or is in flight, so duplicate checkout submissions never send twice.
2. The email is built: shop name, customer name, order number and date, each item's
   quantity, unit price and line total, subtotal, total, shipping address and
   support contact. Customer text is HTML-escaped.
3. It is sent through the Mailgun HTTP API, with a 10-second timeout.
4. `record_order_confirmation_email()` stores the outcome on the order
   (`confirmation_email_status`, attempts, `last_error`, Mailgun message ID) and adds
   a row to `order_email_attempts`.

**An email failure never affects the order.** The order is already committed, the
customer still sees the success page, and the failure is recorded. If the email
failed, the confirmation page offers **Resend confirmation email** (up to 5 attempts per
order). To find failed emails, check the `orders` table for
`confirmation_email_status = 'failed'`, or read `order_email_attempts`.

`MAILGUN_API_KEY`, `MAILGUN_DOMAIN` and `MAILGUN_FROM_EMAIL` are read only in
`server-only` modules. They are validated before use, and the key is never logged.

### Google sign-in (Phase 4)

This uses Supabase Auth's built-in **Google provider**, with no custom OAuth code:

`Continue with Google` → `signInWithOAuth({ provider: "google" })` (PKCE) → Google
consent → Supabase Auth → `/auth/callback` (`exchangeCodeForSession`) → session cookie →
back to the page the user came from.

- **Sessions:** `@supabase/ssr` keeps the session in cookies. `src/proxy.ts` refreshes it
  on every request and redirects signed-out visitors away from `/account`.
- **Identity:** `profiles.id` and `orders.user_id` reference `auth.users(id)`. A profile
  is created automatically from Google's name and picture.
- **Row Level Security:** a signed-in user can `select` only their own `orders` and
  `order_items`. Internal order columns (cart hash, idempotency key, email internals)
  are not readable by clients at all, and users cannot modify orders.
- **Linking guest orders:** at sign-in, orders placed earlier *in the same browser* *and*
  with the same email address are linked to the account.
- Orders remain viewable by the browser that placed them, or by their signed-in owner
  on any device. Everyone else gets a 404.
- No service-role key is used anywhere in the app.

### Guest cart security

- The browser gets a random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie
  (`qx_cart`, 30 days). Only the token's SHA-256 hash is stored in the database.
- Visitors have **no direct access** to `carts` or `cart_items`: RLS is enabled with no
  policies, and table privileges are revoked. All cart operations go through
  `SECURITY DEFINER` functions (`get_cart`, `add_to_cart`, `set_cart_item_quantity`,
  `remove_cart_item`), which require the token.
- Prices and stock always come from the database. Adds are capped at available stock,
  out-of-stock or inactive products are rejected, and quantity increases beyond stock
  are refused. Decreases are always allowed, so a shopper can fix a cart after stock drops.
- Visitors can read categories and active products, and cannot write to either.
- Product data is rendered per request, so stock and prices are always current.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
```

1. Create a Supabase project.
2. Apply the schema: either `supabase link --project-ref <ref> && supabase db push`, or run
   each file in `supabase/migrations/` **in order**, once each, in the SQL Editor:
   `20261002000000_shop_catalog_and_cart.sql`, then `20261003000000_orders_checkout.sql`,
   then `20261004000000_order_confirmation_emails.sql`, then `20261005000000_auth_profiles.sql`.
3. Load sample data by running `supabase/seed.sql`. Manage products and categories
   afterwards in the Table Editor.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
   Project Settings → API, and the Mailgun variables listed in `.env.example`.
5. `npm run dev`

Product images are loaded from whatever `image_url` holds. If an image fails to load,
a placeholder is shown.

### Google sign-in setup

1. In the Google Cloud Console, open APIs & Services, then:
   - **OAuth consent screen:** set the app name and support email.
   - **Credentials → Create OAuth client ID:** choose type **Web application**, and set the
     Authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase:
   - **Authentication → Providers → Google:** enable it, and paste the client ID and secret.
   - **Authentication → URL Configuration:** set **Site URL** to your shop URL, and add
     **Redirect URLs** `https://<your-domain>/**` and `http://localhost:3000/**`.

### Deploying to Vercel

Import the repository and set the two environment variables above.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates route types and runs `tsc` |
| `npm test` | Unit tests; DB tests also run when `TEST_DATABASE_URL` is set |
| `npm run test:db` | SQL integration tests only |
| `npx playwright test` | End-to-end tests against a running app |

### Database tests

These tests create a throwaway database, apply `tests/db/supabase-stub.sql` (Supabase's
roles), the migrations and the seed. They then exercise everything as the `anon` role,
exactly what the browser's key can do.

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

### End-to-end tests

These need a running app connected to a Supabase project with the migrations and the seed
applied:

```bash
npm run build && npm start &
E2E_BASE_URL=http://localhost:3000 npx playwright test
```

The Google sign-in tests (`tests/e2e/auth.spec.ts`, enabled with `E2E_GOOGLE_STANDIN=1`) run
against Supabase Auth (GoTrue) with its real Google provider. Google is replaced by
`tests/e2e/support/fake-google.mjs`. GoTrue's calls to Google's hostnames are routed to it
with `HTTPS_PROXY=http://127.0.0.1:54340` and `SSL_CERT_FILE` (a test CA), while the test
simulates the consent screen. Never use the stand-in outside tests.

Set `E2E_DATABASE_URL` (a direct Postgres connection string) to also run the checkout tests
that verify saved rows and change stock or availability mid-checkout. Without it, those tests
are skipped. Only point it at a test database, because those tests modify product stock.

## Known follow-ups

- Abandoned guest carts are never deleted. Add a scheduled cleanup, for example with
  `pg_cron`: delete carts whose `updated_at` is older than 30 days.
- When accounts arrive (a later phase), merge the guest cart into the user's cart on
  sign-in, and list a signed-in user's orders by `user_id`.
- Payment is not collected; orders stay `pending`. Integrate a payment provider
  before taking real orders.
- Shipping is free (`shipping_cents = 0`) and there is no tax calculation.
