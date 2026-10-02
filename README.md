# Quinnex Store

A Next.js (App Router) online shop backed by Supabase. Built to deploy on Vercel.

**Current scope: Phases 1–2.** The app has a catalogue, product pages, search,
category filtering, a persistent guest cart (Phase 1), and checkout with orders
saved in Supabase (Phase 2). Accounts and sign-in, payments and order emails are
later phases. Orders are saved with status `pending` and no payment is taken.

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
   `20261002000000_shop_catalog_and_cart.sql`, then `20261003000000_orders_checkout.sql`.
3. Load sample data by running `supabase/seed.sql`. Manage products and categories
   afterwards in the Table Editor.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
   Project Settings → API. Phase 1 needs no server-only secrets.
5. `npm run dev`

Product images are loaded from whatever `image_url` holds. If an image fails to load,
a placeholder is shown.

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
