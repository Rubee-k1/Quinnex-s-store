-- Quinnex Store — Phase 1: catalogue (categories, products) and guest cart.
--
-- Money is stored as integer minor units (e.g. cents).
--
-- Guest carts: the browser holds a random secret token in an httpOnly cookie;
-- only its SHA-256 hash is stored. Visitors have NO direct access to the cart
-- tables — every read/write goes through the SECURITY DEFINER functions below,
-- which require the token. Prices and stock always come from the database.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null check (char_length(name) between 1 and 200),
  description  text not null default '',
  category_id  uuid not null references public.categories (id) on delete restrict,
  price_cents  integer not null check (price_cents >= 0),
  currency     char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  image_url    text,
  stock        integer not null default 0 check (stock >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_active_category_idx on public.products (is_active, category_id);
create index products_active_created_idx on public.products (is_active, created_at desc);

-- ---------------------------------------------------------------------------
-- Guest carts
-- ---------------------------------------------------------------------------
create table public.carts (
  id          uuid primary key default gen_random_uuid(),
  token_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.cart_items (
  cart_id     uuid not null references public.carts (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  quantity    integer not null check (quantity between 1 and 99),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (cart_id, product_id)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger carts_set_updated_at before update on public.carts
  for each row execute function public.set_updated_at();
create trigger cart_items_set_updated_at before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security & privileges
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.carts      enable row level security;
alter table public.cart_items enable row level security;

create policy "Categories are public"
  on public.categories for select to anon, authenticated
  using (true);

create policy "Active products are public"
  on public.products for select to anon, authenticated
  using (is_active);

-- carts / cart_items: RLS on with no policies = no direct access for clients.

revoke all on public.categories, public.products, public.carts, public.cart_items
  from anon, authenticated;
grant select on public.categories, public.products to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cart functions
-- ---------------------------------------------------------------------------

-- Internal: validate a token and resolve it to a cart id (null if no cart yet).
create or replace function public._cart_id_for_token(p_token text, p_create boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_cart_id uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  select id into v_cart_id from public.carts where token_hash = v_hash;
  if v_cart_id is null and p_create then
    insert into public.carts (token_hash) values (v_hash)
    on conflict (token_hash) do update set updated_at = now()
    returning id into v_cart_id;
  end if;
  return v_cart_id;
end;
$$;

revoke all on function public._cart_id_for_token(text, boolean) from public, anon, authenticated;

-- Read the cart with current product data. Inactive products are still
-- returned (is_active = false) so the UI can explain why they can't be bought.
create or replace function public.get_cart(p_token text)
returns table (
  product_id  uuid,
  quantity    integer,
  slug        text,
  name        text,
  price_cents integer,
  currency    char(3),
  image_url   text,
  stock       integer,
  is_active   boolean,
  added_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid := public._cart_id_for_token(p_token, false);
begin
  if v_cart_id is null then
    return;
  end if;
  return query
    select ci.product_id, ci.quantity, p.slug, p.name, p.price_cents, p.currency,
           p.image_url, p.stock, p.is_active, ci.created_at
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = v_cart_id
    order by ci.created_at, ci.product_id;
end;
$$;

-- Add (or increase) a product. Quantity is capped at stock and 99.
-- Returns the resulting quantity in the cart.
create or replace function public.add_to_cart(p_token text, p_product_id uuid, p_quantity integer default 1)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid;
  v_stock integer;
  v_new_qty integer;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select stock into v_stock from public.products where id = p_product_id and is_active;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_stock < 1 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001';
  end if;

  v_cart_id := public._cart_id_for_token(p_token, true);

  insert into public.cart_items as ci (cart_id, product_id, quantity)
  values (v_cart_id, p_product_id, least(p_quantity, v_stock, 99))
  on conflict (cart_id, product_id)
  do update set quantity = least(ci.quantity + excluded.quantity, v_stock, 99)
  returning quantity into v_new_qty;

  update public.carts set updated_at = now() where id = v_cart_id;
  return v_new_qty;
end;
$$;

-- Set an item's quantity. Increases beyond available stock are rejected;
-- decreases are always allowed (so a shopper can fix a cart after stock drops).
create or replace function public.set_cart_item_quantity(p_token text, p_product_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid := public._cart_id_for_token(p_token, false);
  v_current integer;
  v_stock integer;
  v_active boolean;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select ci.quantity, p.stock, p.is_active into v_current, v_stock, v_active
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = v_cart_id and ci.product_id = p_product_id
  for update of ci;

  if not found then
    raise exception 'ITEM_NOT_IN_CART' using errcode = 'P0002';
  end if;
  if p_quantity > v_current and (not v_active or p_quantity > v_stock) then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  update public.cart_items set quantity = p_quantity
  where cart_id = v_cart_id and product_id = p_product_id;
  update public.carts set updated_at = now() where id = v_cart_id;
  return p_quantity;
end;
$$;

-- Remove an item. Idempotent: removing something not in the cart is a no-op.
create or replace function public.remove_cart_item(p_token text, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart_id uuid := public._cart_id_for_token(p_token, false);
begin
  if v_cart_id is null then
    return;
  end if;
  delete from public.cart_items where cart_id = v_cart_id and product_id = p_product_id;
  update public.carts set updated_at = now() where id = v_cart_id;
end;
$$;

revoke all on function public.get_cart(text) from public;
revoke all on function public.add_to_cart(text, uuid, integer) from public;
revoke all on function public.set_cart_item_quantity(text, uuid, integer) from public;
revoke all on function public.remove_cart_item(text, uuid) from public;
grant execute on function public.get_cart(text) to anon, authenticated;
grant execute on function public.add_to_cart(text, uuid, integer) to anon, authenticated;
grant execute on function public.set_cart_item_quantity(text, uuid, integer) to anon, authenticated;
grant execute on function public.remove_cart_item(text, uuid) to anon, authenticated;
