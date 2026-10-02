-- Quinnex Store — Phase 4: Supabase Auth (Google) — profiles and per-user order access.
--
-- Identity comes from Supabase Auth (auth.users). Application data references
-- auth.users(id): profiles.id, and orders.user_id (set by place_order() from
-- auth.uid() since Phase 2).
--
-- Row level security:
--   * profiles      — a user can read their own profile (and update their name)
--   * orders        — a signed-in user can read ONLY rows where user_id = auth.uid()
--   * order_items   — only items belonging to such orders
-- Internal columns (cart token hash, idempotency key, email delivery
-- internals) are not readable by clients at all (column-level privileges).

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text check (full_name is null or char_length(full_name) <= 200),
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy "Users read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Create/refresh the profile from the identity provider's metadata (Google
-- supplies full_name/name and avatar_url/picture).
create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), 200),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do update set
    email = excluded.email,
    -- keep a name the user edited; only fill it if empty
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

revoke all on function public.handle_auth_user_profile() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_profile();

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_profile();

-- Backfill profiles for users that already exist.
insert into public.profiles (id, email, full_name, avatar_url)
select u.id, u.email,
       left(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), 200),
       coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Orders: signed-in users may read their own orders (and only those).
-- ---------------------------------------------------------------------------
grant select (
  id, order_number, user_id, status, currency,
  subtotal_cents, shipping_cents, total_cents,
  email, customer_name, phone,
  shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_postal_code, shipping_country,
  confirmation_email_status, confirmation_email_sent_at,
  created_at, updated_at
) on public.orders to authenticated;

create policy "Users read own orders"
  on public.orders for select to authenticated
  using (user_id is not null and (select auth.uid()) = user_id);

grant select on public.order_items to authenticated;

create policy "Users read items of own orders"
  on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.user_id is not null
      and o.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- link_guest_orders_to_user: after signing in, attach guest orders that were
-- placed IN THIS BROWSER (same cart token) AND with the same email address as
-- the signed-in account. Both conditions are required, so signing in on a
-- shared computer can't claim someone else's orders. Returns the number linked.
-- ---------------------------------------------------------------------------
create or replace function public.link_guest_orders_to_user(p_token text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;

  update public.orders o
  set user_id = v_uid
  where o.user_id is null
    and o.cart_token_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))
    and lower(o.email) = v_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_guest_orders_to_user(text) from public, anon;
grant execute on function public.link_guest_orders_to_user(text) to authenticated;
