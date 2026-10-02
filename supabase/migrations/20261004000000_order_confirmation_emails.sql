-- Quinnex Store — Phase 3: order confirmation email tracking.
--
-- The order itself is never touched by email handling beyond these tracking
-- columns: an email failure can't roll back or delete an order.
--
--  * orders.confirmation_email_*  — current state, for display and retries
--  * order_email_attempts         — one row per delivery attempt (diagnostics)
--
-- The app server sends the email; the database coordinates it:
--  1. claim_order_confirmation_email() atomically moves the order to 'sending'
--     (only from 'pending' or 'failed', or a stale 'sending'), so concurrent or
--     duplicate checkout submissions can't send the same email twice.
--  2. record_order_confirmation_email() stores the outcome and logs the attempt.
-- Both only work for the browser (cart token) that placed the order.

alter table public.orders
  add column confirmation_email_status text not null default 'pending'
    check (confirmation_email_status in ('pending', 'sending', 'sent', 'failed')),
  add column confirmation_email_attempts integer not null default 0 check (confirmation_email_attempts >= 0),
  add column confirmation_email_claimed_at timestamptz,
  add column confirmation_email_sent_at timestamptz,
  add column confirmation_email_message_id text,
  add column confirmation_email_last_error text;

create index orders_confirmation_email_failed_idx on public.orders (created_at)
  where confirmation_email_status = 'failed';

create table public.order_email_attempts (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  kind                 text not null default 'order_confirmation',
  outcome              text not null check (outcome in ('sent', 'failed')),
  recipient            text,
  provider_message_id  text,
  error                text,
  attempted_at         timestamptz not null default now()
);

create index order_email_attempts_order_idx on public.order_email_attempts (order_id, attempted_at desc);

alter table public.order_email_attempts enable row level security;
revoke all on public.order_email_attempts from anon, authenticated;

-- Maximum delivery attempts per order (initial send + customer-initiated resends).
create or replace function public._max_confirmation_email_attempts()
returns integer language sql immutable set search_path = '' as $$ select 5 $$;
revoke all on function public._max_confirmation_email_attempts() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_order: same as Phase 2, plus the confirmation email state.
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
           'confirmation_email_status', o.confirmation_email_status,
           'confirmation_email_attempts', o.confirmation_email_attempts,
           'confirmation_email_sent_at', o.confirmation_email_sent_at,
           'confirmation_email_can_retry',
             o.confirmation_email_status = 'failed'
             and o.confirmation_email_attempts < public._max_confirmation_email_attempts(),
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

-- ---------------------------------------------------------------------------
-- claim_order_confirmation_email: returns the order (with items) if the caller
-- may send its confirmation now, else null (already sent, in flight, attempts
-- exhausted, or not the caller's order).
-- ---------------------------------------------------------------------------
create or replace function public.claim_order_confirmation_email(p_token text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_claimed uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  update public.orders o
  set confirmation_email_status = 'sending',
      confirmation_email_claimed_at = now(),
      confirmation_email_attempts = o.confirmation_email_attempts + 1
  where o.id = p_order_id
    and o.cart_token_hash = v_hash
    and o.confirmation_email_attempts < public._max_confirmation_email_attempts()
    and (
      o.confirmation_email_status in ('pending', 'failed')
      -- recover from a send that never reported back (e.g. a crashed request)
      or (o.confirmation_email_status = 'sending' and o.confirmation_email_claimed_at < now() - interval '2 minutes')
    )
  returning o.id into v_claimed;

  if v_claimed is null then
    return null;
  end if;
  return public.get_order(p_token, p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_order_confirmation_email: stores the outcome of a claimed send.
-- Returns false if there was no claim in progress (nothing is changed).
-- ---------------------------------------------------------------------------
create or replace function public.record_order_confirmation_email(
  p_token       text,
  p_order_id    uuid,
  p_sent        boolean,
  p_message_id  text,
  p_error       text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_email text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'INVALID_CART_TOKEN' using errcode = '22023';
  end if;
  if p_sent is null then
    raise exception 'INVALID_INPUT: p_sent' using errcode = '22023';
  end if;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));

  update public.orders o
  set confirmation_email_status = case when p_sent then 'sent' else 'failed' end,
      confirmation_email_sent_at = case when p_sent then now() else o.confirmation_email_sent_at end,
      confirmation_email_message_id = case when p_sent then left(p_message_id, 200) else o.confirmation_email_message_id end,
      confirmation_email_last_error = case when p_sent then null else left(coalesce(p_error, 'unknown error'), 500) end
  where o.id = p_order_id
    and o.cart_token_hash = v_hash
    and o.confirmation_email_status = 'sending'
  returning o.email into v_email;

  if not found then
    return false;
  end if;

  insert into public.order_email_attempts (order_id, outcome, recipient, provider_message_id, error)
  values (
    p_order_id,
    case when p_sent then 'sent' else 'failed' end,
    v_email,
    case when p_sent then left(p_message_id, 200) end,
    case when p_sent then null else left(coalesce(p_error, 'unknown error'), 500) end
  );
  return true;
end;
$$;

revoke all on function public.claim_order_confirmation_email(text, uuid) from public;
revoke all on function public.record_order_confirmation_email(text, uuid, boolean, text, text) from public;
grant execute on function public.claim_order_confirmation_email(text, uuid) to anon, authenticated;
grant execute on function public.record_order_confirmation_email(text, uuid, boolean, text, text) to anon, authenticated;
