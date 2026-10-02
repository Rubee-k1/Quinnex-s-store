-- Quinnex Store — Phase 2: checkout and order persistence.
--
-- Orders are created ONLY by public.place_order(), which runs as a single
-- transaction: it locks the products being bought, validates that each one
-- still exists, is active and has enough stock, recalculates every price and
-- total from the database (never from the browser), writes the order and its
-- line items (with name/price snapshots), decrements stock and empties the cart.
-- If any check fails, the whole transaction is rolled back.
--
-- Ownership: an order belongs to the guest cart that placed it (we store the
-- SHA-256 hash of the cart cookie token, never the token itself). When the
-- shopper is signed in (a later phase), auth.uid() is recorded as user_id.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create type public.order_status as enum ('pending', 'paid', 'fulfilled', 'cancelled');

create sequence public.order_number_seq start 1001;

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_number          bigint not null unique default nextval('public.order_number_seq'),
  user_id               uuid references auth.users (id) on delete set null,
  cart_token_hash       bytea not null,
  idempotency_key       uuid not null unique,
  status                public.order_status not null default 'pending',
  currency              char(3) not null,
  subtotal_cents        integer not null check (subtotal_cents >= 0),
  shipping_cents        integer not null default 0 check (shipping_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  email                 text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  customer_name         text not null check (char_length(customer_name) between 1 and 120),
  phone                 text,
  shipping_line1        text not null,
  shipping_line2        text,
  shipping_city         text not null,
  shipping_state        text,
  shipping_postal_code  text not null,
  shipping_country      char(2) not null check (shipping_country ~ '^[A-Z]{2}$'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (total_cents = subtotal_cents + shipping_cents)
);

alter sequence public.order_number_seq owned by public.orders.order_number;

create index orders_cart_token_hash_idx on public.orders (cart_token_hash, created_at desc);
create index orders_user_id_idx on public.orders (user_id, created_at desc) where user_id is not null;

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  product_name      text not null,
  product_slug      text not null,
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  quantity          integer not null check (quantity between 1 and 99),
  line_total_cents  integer not null check (line_total_cents >= 0),
  check (line_total_cents = unit_price_cents * quantity)
);

create index order_items_order_idx on public.order_items (order_id);

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- No direct client access: RLS on with no policies, privileges revoked.
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from anon, authenticated;
revoke all on sequence public.order_number_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cart fingerprint: a digest of what the shopper saw (items, quantities,
-- prices, availability). The checkout page sends it back; if the cart changed
-- in the meantime, place_order refuses so nobody is charged for something
-- they didn't review. It is a consistency check only — never used for pricing.
-- ---------------------------------------------------------------------------
create or replace function public._cart_fingerprint(p_cart_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.md5(coalesce(string_agg(
           ci.product_id::text || ':' || ci.quantity || ':' || p.price_cents || ':' || p.currency || ':' || p.is_active,
           ',' order by ci.product_id), ''))
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = p_cart_id
$$;

revoke all on function public._cart_fingerprint(uuid) from public, anon, authenticated;

create or replace function public.get_cart_fingerprint(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid := public._cart_id_for_token(p_token, false);
begin
  return public._cart_fingerprint(v_cart_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- place_order
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_token                text,
  p_idempotency_key      uuid,
  p_expected_fingerprint text,
  p_customer             jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash          bytea;
  v_cart_id       uuid;
  v_order_id      uuid;
  v_existing_hash bytea;
  v_currency      char(3);
  v_currencies    integer;
  v_subtotal      bigint;
  v_item          record;
  v_email         text := lower(trim(coalesce(p_customer->>'email', '')));
  v_name          text := trim(coalesce(p_customer->>'name', ''));
  v_line1         text := trim(coalesce(p_customer->>'line1', ''));
  v_city          text := trim(coalesce(p_customer->>'city', ''));
  v_postal        text := trim(coalesce(p_customer->>'postal_code', ''));
  v_country       text := upper(trim(coalesce(p_customer->>'country', '')));
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT: idempotency key' using errcode = '22023';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  -- Serialise checkouts per cart so a double-submit can't race past the
  -- idempotency check below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.encode(v_hash, 'hex'), 0));

  -- Idempotency: the same checkout submission returns the same order.
  select id, cart_token_hash into v_order_id, v_existing_hash
  from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_order_id;
  end if;

  -- Customer details (the app validates too; this is the backstop).
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'INVALID_INPUT: email' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'INVALID_INPUT: name' using errcode = '22023';
  end if;
  if v_line1 = '' or v_city = '' or v_postal = '' or v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_INPUT: shipping address' using errcode = '22023';
  end if;

  select id into v_cart_id from public.carts where token_hash = v_hash;
  if v_cart_id is null or not exists (select 1 from public.cart_items where cart_id = v_cart_id) then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;

  -- Lock the products being bought (stable order avoids deadlocks).
  perform 1
  from public.products p
  where p.id in (select product_id from public.cart_items where cart_id = v_cart_id)
  order by p.id
  for update;

  if p_expected_fingerprint is distinct from public._cart_fingerprint(v_cart_id) then
    raise exception 'CART_CHANGED' using errcode = 'P0001';
  end if;

  for v_item in
    select p.name, p.stock, p.is_active, ci.quantity
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
    order by p.name
  loop
    if not v_item.is_active then
      raise exception 'PRODUCT_UNAVAILABLE: %', v_item.name using errcode = 'P0001';
    end if;
    if v_item.stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK: % (% available)', v_item.name, v_item.stock using errcode = 'P0001';
    end if;
  end loop;

  select count(distinct p.currency), min(p.currency), sum(p.price_cents::bigint * ci.quantity)
    into v_currencies, v_currency, v_subtotal
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  if v_currencies <> 1 then
    raise exception 'MIXED_CURRENCY' using errcode = 'P0001';
  end if;
  if v_subtotal > 2147483647 then
    raise exception 'ORDER_TOO_LARGE' using errcode = 'P0001';
  end if;

  insert into public.orders (
    user_id, cart_token_hash, idempotency_key, currency,
    subtotal_cents, shipping_cents, total_cents,
    email, customer_name, phone,
    shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_postal_code, shipping_country
  ) values (
    auth.uid(), v_hash, p_idempotency_key, v_currency,
    v_subtotal, 0, v_subtotal,
    v_email, v_name, nullif(trim(coalesce(p_customer->>'phone', '')), ''),
    v_line1, nullif(trim(coalesce(p_customer->>'line2', '')), ''), v_city,
    nullif(trim(coalesce(p_customer->>'state', '')), ''), v_postal, v_country
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name, product_slug, unit_price_cents, quantity, line_total_cents)
  select v_order_id, p.id, p.name, p.slug, p.price_cents, ci.quantity, p.price_cents * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id;

  update public.products p
  set stock = p.stock - ci.quantity
  from public.cart_items ci
  where ci.cart_id = v_cart_id and ci.product_id = p.id;

  -- Empty the cart but keep the cart row: its token still identifies the
  -- shopper's orders on this device.
  delete from public.cart_items where cart_id = v_cart_id;
  update public.carts set updated_at = now() where id = v_cart_id;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_order: returns an order with its items, only to the cart that placed it
-- (or to its signed-in owner, for a later phase). Null otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.get_order(p_token text, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_result jsonb;
begin
  if p_token is not null and p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;
  if p_token is not null then
    v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
  end if;

  select jsonb_build_object(
           'id', o.id,
           'order_number', o.order_number,
           'status', o.status,
           'currency', o.currency,
           'subtotal_cents', o.subtotal_cents,
           'shipping_cents', o.shipping_cents,
           'total_cents', o.total_cents,
           'email', o.email,
           'customer_name', o.customer_name,
           'phone', o.phone,
           'shipping_line1', o.shipping_line1,
           'shipping_line2', o.shipping_line2,
           'shipping_city', o.shipping_city,
           'shipping_state', o.shipping_state,
           'shipping_postal_code', o.shipping_postal_code,
           'shipping_country', o.shipping_country,
           'created_at', o.created_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', i.id,
                      'product_id', i.product_id,
                      'product_name', i.product_name,
                      'product_slug', i.product_slug,
                      'unit_price_cents', i.unit_price_cents,
                      'quantity', i.quantity,
                      'line_total_cents', i.line_total_cents
                    ) order by i.product_name)
             from public.order_items i where i.order_id = o.id
           ), '[]'::jsonb)
         )
    into v_result
  from public.orders o
  where o.id = p_order_id
    and (o.cart_token_hash = v_hash or (auth.uid() is not null and o.user_id = auth.uid()));

  return v_result;
end;
$$;

revoke all on function public.get_cart_fingerprint(text) from public;
revoke all on function public.place_order(text, uuid, text, jsonb) from public;
revoke all on function public.get_order(text, uuid) from public;
grant execute on function public.get_cart_fingerprint(text) to anon, authenticated;
grant execute on function public.place_order(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.get_order(text, uuid) to anon, authenticated;
