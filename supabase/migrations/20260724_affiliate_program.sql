begin;

do $$
begin
  if to_regclass('public.subscriptions') is null then
    raise exception 'Affiliate migration requires the existing public.subscriptions table';
  end if;
  if not exists (
    select 1
    from pg_class
    where oid = 'public.subscriptions'::regclass
      and relkind in ('r', 'p')
  ) then
    raise exception 'public.subscriptions must be a table';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'user_id'
      and udt_name = 'uuid'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'status'
      and data_type = 'text'
  ) then
    raise exception 'public.subscriptions requires user_id uuid and status text';
  end if;
  if not exists (
    select 1
    from pg_index i
    join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attname = 'user_id'
    where i.indrelid = 'public.subscriptions'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 1
      and a.attnum = any(i.indkey::smallint[])
  ) then
    raise exception 'public.subscriptions.user_id must have a single-column unique constraint';
  end if;
end;
$$;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null,
  display_name text not null,
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'paused', 'closed')),
  stripe_connect_account_id text unique,
  stripe_transfers_status text not null default 'pending'
    check (stripe_transfers_status in ('active', 'pending', 'restricted', 'unsupported')),
  recipient_payouts_status text not null default 'pending'
    check (recipient_payouts_status in ('active', 'pending', 'restricted', 'unsupported')),
  requirements_status text not null default 'currently_due'
    check (requirements_status in ('complete', 'eventually_due', 'currently_due', 'past_due')),
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  tax_setup_status text not null default 'not_started'
    check (tax_setup_status in ('not_started', 'pending', 'complete', 'action_required')),
  accepted_terms_version text not null,
  accepted_terms_at timestamptz not null,
  activated_at timestamptz,
  paused_at timestamptz,
  stripe_status_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliates_code_format_check check (
    code = upper(code)
    and code ~ '^[A-Z0-9-]{4,20}$'
  ),
  constraint affiliates_code_reserved_check check (
    code not in ('SINEDAY', 'ADMIN', 'SUPPORT', 'PREMIUM', 'STRIPE', 'RALUX')
  ),
  constraint affiliates_display_name_check check (
    char_length(btrim(display_name)) between 2 and 80
  )
);

create unique index affiliates_code_upper_uidx on public.affiliates (upper(code));
create index affiliates_user_id_idx on public.affiliates (user_id);

create table public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  subscriber_user_id uuid not null unique references auth.users(id) on delete cascade,
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  source_code text not null,
  status text not null default 'active'
    check (status in ('active', 'ended', 'reversed')),
  attributed_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_attributions_source_code_check check (
    source_code = upper(source_code)
    and source_code ~ '^[A-Z0-9-]{4,20}$'
  )
);

create index affiliate_attributions_affiliate_status_idx
  on public.affiliate_attributions (affiliate_id, status);
create index affiliate_attributions_subscriber_idx
  on public.affiliate_attributions (subscriber_user_id);

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  payout_month date not null,
  gross_amount_cents integer not null check (gross_amount_cents >= 0),
  adjustment_amount_cents integer not null default 0,
  net_amount_cents integer not null check (net_amount_cents > 0),
  commission_count integer not null check (commission_count >= 0),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'failed', 'held')),
  stripe_transfer_id text unique,
  stripe_destination_account_id text not null,
  claim_token uuid,
  lease_expires_at timestamptz,
  transfer_request_started_at timestamptz,
  transfer_failure_confirmed_at timestamptz,
  failure_message text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliate_id, payout_month),
  constraint affiliate_payouts_month_start_check
    check (payout_month = date_trunc('month', payout_month)::date),
  constraint affiliate_payouts_amount_math_check
    check (net_amount_cents = gross_amount_cents + adjustment_amount_cents),
  constraint affiliate_payouts_paid_state_check
    check (
      status <> 'paid'
      or (
        stripe_transfer_id is not null
        and paid_at is not null
      )
    )
);

create index affiliate_payouts_affiliate_month_idx
  on public.affiliate_payouts (affiliate_id, payout_month desc);

create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  subscriber_user_id uuid not null references auth.users(id) on delete restrict,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text not null,
  stripe_event_id text,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  amount_cents integer not null default 100 check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'available', 'processing', 'paid', 'reversed', 'held')),
  available_at timestamptz not null,
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  reversal_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index affiliate_commissions_affiliate_status_available_idx
  on public.affiliate_commissions (affiliate_id, status, available_at);
create index affiliate_commissions_subscriber_idx
  on public.affiliate_commissions (subscriber_user_id);
create index affiliate_commissions_payout_idx
  on public.affiliate_commissions (payout_id)
  where payout_id is not null;

create table public.affiliate_adjustments (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  commission_id uuid references public.affiliate_commissions(id) on delete set null,
  stripe_invoice_id text,
  stripe_refund_id text,
  stripe_dispute_id text,
  idempotency_key text not null unique,
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null
    check (reason in ('refund', 'partial_refund', 'dispute', 'dispute_won', 'manual_correction')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'applied', 'waived')),
  waiver_reason text,
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint affiliate_adjustments_waiver_reason_check check (
    (status = 'waived' and waiver_reason in ('commission_not_transferred', 'manual_forgiveness'))
    or (status <> 'waived' and waiver_reason is null)
  )
);

create index affiliate_adjustments_commission_idx
  on public.affiliate_adjustments (commission_id)
  where commission_id is not null;
create index affiliate_adjustments_affiliate_status_idx
  on public.affiliate_adjustments (affiliate_id, status);
create index affiliate_adjustments_payout_idx
  on public.affiliate_adjustments (payout_id)
  where payout_id is not null;

create table public.affiliate_invoice_events (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null,
  event_kind text not null
    check (event_kind in ('refund', 'credit_note', 'dispute')),
  stripe_object_id text not null,
  dispute_status text
    check (dispute_status is null or dispute_status in ('open', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_kind, stripe_object_id),
  constraint affiliate_invoice_events_dispute_state_check check (
    (event_kind = 'dispute' and dispute_status is not null)
    or (event_kind <> 'dispute' and dispute_status is null)
  )
);

create index affiliate_invoice_events_invoice_idx
  on public.affiliate_invoice_events (stripe_invoice_id, event_kind, dispute_status);

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  source text not null check (source in ('billing', 'connect')),
  status text not null check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  claim_token uuid,
  updated_at timestamptz not null default now()
);

create index stripe_webhook_events_recovery_idx
  on public.stripe_webhook_events (status, updated_at);

drop trigger if exists trg_affiliates_updated_at on public.affiliates;
create trigger trg_affiliates_updated_at
before update on public.affiliates
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_affiliate_attributions_updated_at on public.affiliate_attributions;
create trigger trg_affiliate_attributions_updated_at
before update on public.affiliate_attributions
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_affiliate_commissions_updated_at on public.affiliate_commissions;
create trigger trg_affiliate_commissions_updated_at
before update on public.affiliate_commissions
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_affiliate_payouts_updated_at on public.affiliate_payouts;
create trigger trg_affiliate_payouts_updated_at
before update on public.affiliate_payouts
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_affiliate_invoice_events_updated_at on public.affiliate_invoice_events;
create trigger trg_affiliate_invoice_events_updated_at
before update on public.affiliate_invoice_events
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_stripe_webhook_events_updated_at on public.stripe_webhook_events;
create trigger trg_stripe_webhook_events_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_row_updated_at();

alter table public.affiliates enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_adjustments enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_invoice_events enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.affiliates from anon, authenticated;
revoke all on public.affiliate_attributions from anon, authenticated;
revoke all on public.affiliate_commissions from anon, authenticated;
revoke all on public.affiliate_adjustments from anon, authenticated;
revoke all on public.affiliate_payouts from anon, authenticated;
revoke all on public.affiliate_invoice_events from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

grant select on public.affiliates to authenticated;
grant select on public.affiliate_attributions to authenticated;
grant all on public.affiliates to service_role;
grant all on public.affiliate_attributions to service_role;
grant all on public.affiliate_commissions to service_role;
grant all on public.affiliate_adjustments to service_role;
grant all on public.affiliate_payouts to service_role;
grant all on public.affiliate_invoice_events to service_role;
grant all on public.stripe_webhook_events to service_role;

drop policy if exists "Members can read own affiliate account" on public.affiliates;
create policy "Members can read own affiliate account"
on public.affiliates
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Members can read own attribution" on public.affiliate_attributions;
create policy "Members can read own attribution"
on public.affiliate_attributions
for select
to authenticated
using (subscriber_user_id = (select auth.uid()));

create or replace function public.claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_source text,
  p_recovery_timeout_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.stripe_webhook_events%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  if p_source not in ('billing', 'connect') then
    raise exception 'INVALID_WEBHOOK_SOURCE';
  end if;

  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    source,
    status,
    claim_token
  )
  values (
    p_stripe_event_id,
    p_event_type,
    p_source,
    'processing',
    v_claim_token
  )
  on conflict (stripe_event_id) do nothing;

  if found then
    return jsonb_build_object('action', 'process', 'claim_token', v_claim_token);
  end if;

  select *
  into v_event
  from public.stripe_webhook_events
  where stripe_event_id = p_stripe_event_id
  for update;

  if v_event.event_type <> p_event_type or v_event.source <> p_source then
    raise exception 'WEBHOOK_EVENT_ID_COLLISION';
  end if;

  if v_event.status = 'processed' then
    return jsonb_build_object('action', 'duplicate');
  end if;

  if v_event.status = 'processing'
     and v_event.updated_at > now() - make_interval(secs => p_recovery_timeout_seconds) then
    return jsonb_build_object('action', 'busy');
  end if;

  update public.stripe_webhook_events
  set status = 'processing',
      attempts = attempts + 1,
      last_error = null,
      processed_at = null,
      claim_token = v_claim_token
  where stripe_event_id = p_stripe_event_id;

  return jsonb_build_object('action', 'process', 'claim_token', v_claim_token);
end;
$$;

create or replace function public.complete_stripe_webhook_event(
  p_stripe_event_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stripe_webhook_events
  set status = 'processed',
      processed_at = now(),
      last_error = null,
      claim_token = null
  where stripe_event_id = p_stripe_event_id
    and status = 'processing'
    and claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.fail_stripe_webhook_event(
  p_stripe_event_id text,
  p_claim_token uuid,
  p_last_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stripe_webhook_events
  set status = 'failed',
      last_error = left(coalesce(p_last_error, 'Processing failed'), 500),
      claim_token = null
  where stripe_event_id = p_stripe_event_id
    and status = 'processing'
    and claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.create_affiliate_attribution(
  p_subscriber_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(p_code));
  v_affiliate public.affiliates%rowtype;
  v_existing record;
  v_subscription_status text;
  v_attribution public.affiliate_attributions%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_subscriber_user_id::text, 0));

  select status
  into v_subscription_status
  from public.subscriptions
  where user_id = p_subscriber_user_id
  for share;

  if v_subscription_status is null
     or v_subscription_status <> 'active' then
    raise exception 'AFFILIATE_STRIPE_PREMIUM_REQUIRED';
  end if;

  select aa.*, a.code, a.display_name
  into v_existing
  from public.affiliate_attributions aa
  join public.affiliates a on a.id = aa.affiliate_id
  where aa.subscriber_user_id = p_subscriber_user_id;

  if found then
    if v_existing.status = 'active' and v_existing.code = v_code then
      return jsonb_build_object(
        'id', v_existing.id,
        'affiliate_id', v_existing.affiliate_id,
        'affiliate_code', v_existing.code,
        'affiliate_display_name', v_existing.display_name,
        'attributed_at', v_existing.attributed_at,
        'existing', true
      );
    end if;
    raise exception 'AFFILIATE_ATTRIBUTION_ALREADY_EXISTS';
  end if;

  select *
  into v_affiliate
  from public.affiliates
  where upper(code) = v_code
  for update;

  if not found or v_affiliate.status <> 'active' then
    raise exception 'AFFILIATE_CODE_NOT_ACTIVE';
  end if;

  if v_affiliate.user_id = p_subscriber_user_id then
    raise exception 'AFFILIATE_SELF_REFERRAL';
  end if;

  insert into public.affiliate_attributions (
    subscriber_user_id,
    affiliate_id,
    source_code
  )
  values (
    p_subscriber_user_id,
    v_affiliate.id,
    v_affiliate.code
  )
  returning * into v_attribution;

  return jsonb_build_object(
    'id', v_attribution.id,
    'affiliate_id', v_affiliate.id,
    'affiliate_code', v_affiliate.code,
    'affiliate_display_name', v_affiliate.display_name,
    'attributed_at', v_attribution.attributed_at,
    'existing', false
  );
exception
  when unique_violation then
    raise exception 'AFFILIATE_ATTRIBUTION_ALREADY_EXISTS';
end;
$$;

create or replace function public.record_affiliate_commission(
  p_subscriber_user_id uuid,
  p_stripe_invoice_id text,
  p_stripe_subscription_id text,
  p_stripe_event_id text,
  p_paid_at timestamptz,
  p_billing_period_start timestamptz default null,
  p_billing_period_end timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attribution record;
  v_commission_id uuid;
begin
  select aa.affiliate_id, a.user_id as affiliate_user_id
  into v_attribution
  from public.affiliate_attributions aa
  join public.affiliates a on a.id = aa.affiliate_id
  where aa.subscriber_user_id = p_subscriber_user_id
    and aa.status = 'active'
    and a.status = 'active'
  for update of aa, a;

  if not found or v_attribution.affiliate_user_id = p_subscriber_user_id then
    return null;
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    subscriber_user_id,
    stripe_invoice_id,
    stripe_subscription_id,
    stripe_event_id,
    billing_period_start,
    billing_period_end,
    amount_cents,
    status,
    available_at
  )
  values (
    v_attribution.affiliate_id,
    p_subscriber_user_id,
    p_stripe_invoice_id,
    p_stripe_subscription_id,
    p_stripe_event_id,
    p_billing_period_start,
    p_billing_period_end,
    100,
    'pending',
    p_paid_at + interval '30 days'
  )
  on conflict (stripe_invoice_id) do nothing
  returning id into v_commission_id;

  if v_commission_id is null then
    select id
    into v_commission_id
    from public.affiliate_commissions
    where stripe_invoice_id = p_stripe_invoice_id;
  end if;

  return v_commission_id;
end;
$$;

create or replace function public.reverse_affiliate_commission(
  p_stripe_invoice_id text,
  p_reason text,
  p_stripe_refund_id text default null,
  p_stripe_dispute_id text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_adjustment_reason text;
begin
  select *
  into v_commission
  from public.affiliate_commissions
  where stripe_invoice_id = p_stripe_invoice_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_commission.status in ('pending', 'available', 'held') then
    update public.affiliate_commissions
    set status = 'reversed',
        reversal_reason = left(p_reason, 120),
        payout_id = null
    where id = v_commission.id;
    return 'reversed';
  end if;

  if v_commission.status = 'paid' then
    v_adjustment_reason := case
      when p_stripe_dispute_id is not null then 'dispute'
      when p_reason = 'partial_refund' then 'partial_refund'
      else 'refund'
    end;

    insert into public.affiliate_adjustments (
      affiliate_id,
      commission_id,
      stripe_invoice_id,
      stripe_refund_id,
      stripe_dispute_id,
      idempotency_key,
      amount_cents,
      reason
    )
    values (
      v_commission.affiliate_id,
      v_commission.id,
      v_commission.stripe_invoice_id,
      p_stripe_refund_id,
      p_stripe_dispute_id,
      'debit:' || v_commission.id::text,
      -v_commission.amount_cents,
      v_adjustment_reason
    )
    on conflict do nothing;
    return 'adjusted';
  end if;

  return 'unchanged';
end;
$$;

create or replace function public.hold_affiliate_commission_for_dispute(
  p_stripe_invoice_id text,
  p_stripe_dispute_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
begin
  select *
  into v_commission
  from public.affiliate_commissions
  where stripe_invoice_id = p_stripe_invoice_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_commission.status in ('pending', 'available') then
    update public.affiliate_commissions
    set status = 'held',
        reversal_reason = 'dispute:' || p_stripe_dispute_id
    where id = v_commission.id;
    return 'held';
  end if;

  if v_commission.status = 'paid' then
    insert into public.affiliate_adjustments (
      affiliate_id,
      commission_id,
      stripe_invoice_id,
      stripe_dispute_id,
      idempotency_key,
      amount_cents,
      reason
    )
    values (
      v_commission.affiliate_id,
      v_commission.id,
      v_commission.stripe_invoice_id,
      p_stripe_dispute_id,
      'dispute:' || p_stripe_dispute_id,
      -v_commission.amount_cents,
      'dispute'
    )
    on conflict do nothing;
    return 'adjusted';
  end if;

  return 'unchanged';
end;
$$;

create or replace function public.resolve_affiliate_commission_dispute(
  p_stripe_invoice_id text,
  p_stripe_dispute_id text,
  p_won boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_debit public.affiliate_adjustments%rowtype;
begin
  select *
  into v_commission
  from public.affiliate_commissions
  where stripe_invoice_id = p_stripe_invoice_id
  for update;

  if not found then
    return 'not_found';
  end if;

  if not p_won then
    if v_commission.status = 'held' then
      update public.affiliate_commissions
      set status = 'reversed',
          reversal_reason = 'dispute_lost:' || p_stripe_dispute_id
      where id = v_commission.id;
      return 'reversed';
    end if;
    return 'unchanged';
  end if;

  if v_commission.status = 'held' then
    update public.affiliate_commissions
    set status = case when available_at <= now() then 'available' else 'pending' end,
        reversal_reason = null
    where id = v_commission.id;
    return 'restored';
  end if;

  select *
  into v_debit
  from public.affiliate_adjustments
  where commission_id = v_commission.id
    and stripe_dispute_id = p_stripe_dispute_id
    and amount_cents < 0
  order by created_at
  limit 1;

  if found then
    insert into public.affiliate_adjustments (
      affiliate_id,
      commission_id,
      stripe_invoice_id,
      stripe_dispute_id,
      idempotency_key,
      amount_cents,
      reason
    )
    values (
      v_commission.affiliate_id,
      v_commission.id,
      v_commission.stripe_invoice_id,
      p_stripe_dispute_id,
      'dispute-won:' || p_stripe_dispute_id,
      abs(v_debit.amount_cents),
      'dispute_won'
    )
    on conflict do nothing;
    return 'adjusted';
  end if;

  return 'unchanged';
end;
$$;

create or replace function public.reconcile_affiliate_commission(
  p_stripe_invoice_id text,
  p_event_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.affiliate_commissions%rowtype;
  v_permanently_reversed boolean;
  v_open_dispute boolean;
  v_target_adjustment integer;
  v_current_adjustment integer;
  v_delta integer;
  v_reason text;
  v_adjustment_id uuid;
begin
  select *
  into v_commission
  from public.affiliate_commissions
  where stripe_invoice_id = p_stripe_invoice_id
  for update;

  if not found then
    return 'not_found';
  end if;

  select exists (
    select 1
    from public.affiliate_invoice_events
    where stripe_invoice_id = p_stripe_invoice_id
      and (
        event_kind in ('refund', 'credit_note')
        or (event_kind = 'dispute' and dispute_status = 'lost')
      )
  )
  into v_permanently_reversed;

  select exists (
    select 1
    from public.affiliate_invoice_events
    where stripe_invoice_id = p_stripe_invoice_id
      and event_kind = 'dispute'
      and dispute_status = 'open'
  )
  into v_open_dispute;

  if v_commission.status in ('pending', 'available', 'held') then
    update public.affiliate_adjustments
    set status = 'waived',
        waiver_reason = 'commission_not_transferred'
    where commission_id = v_commission.id
      and payout_id is null
      and status = 'pending'
      and reason in ('refund', 'partial_refund', 'dispute', 'dispute_won');

    if v_permanently_reversed then
      update public.affiliate_commissions
      set status = 'reversed',
          reversal_reason = 'invoice_reversed'
      where id = v_commission.id;
      return 'reversed';
    end if;

    if v_open_dispute then
      update public.affiliate_commissions
      set status = 'held',
          reversal_reason = 'open_dispute'
      where id = v_commission.id;
      return 'held';
    end if;

    if v_commission.status = 'held' then
      update public.affiliate_commissions
      set status = case when available_at <= now() then 'available' else 'pending' end,
          reversal_reason = null
      where id = v_commission.id;
      return 'restored';
    end if;

    return 'unchanged';
  end if;

  if v_commission.status not in ('processing', 'paid') then
    return 'unchanged';
  end if;

  v_target_adjustment := case
    when v_permanently_reversed or v_open_dispute then -v_commission.amount_cents
    else 0
  end;

  if v_target_adjustment < 0 and exists (
    select 1
    from public.affiliate_adjustments
    where commission_id = v_commission.id
      and status = 'waived'
      and waiver_reason = 'manual_forgiveness'
      and amount_cents < 0
  ) then
    return 'waived';
  end if;

  select coalesce(sum(amount_cents), 0)
  into v_current_adjustment
  from public.affiliate_adjustments
  where commission_id = v_commission.id
    and reason in ('refund', 'partial_refund', 'dispute', 'dispute_won')
    and status <> 'waived';

  v_delta := v_target_adjustment - v_current_adjustment;
  if v_delta = 0 then
    return 'unchanged';
  end if;

  v_reason := case
    when v_delta > 0 then 'dispute_won'
    when v_permanently_reversed then 'refund'
    else 'dispute'
  end;

  insert into public.affiliate_adjustments (
    affiliate_id,
    commission_id,
    stripe_invoice_id,
    idempotency_key,
    amount_cents,
    reason
  )
  values (
    v_commission.affiliate_id,
    v_commission.id,
    v_commission.stripe_invoice_id,
    'reconcile:' || p_event_key,
    v_delta,
    v_reason
  )
  on conflict (idempotency_key) do nothing
  returning id into v_adjustment_id;

  if v_adjustment_id is null then
    raise exception 'AFFILIATE_ADJUSTMENT_IDEMPOTENCY_COLLISION';
  end if;

  return 'adjusted';
end;
$$;

create or replace function public.record_affiliate_invoice_event(
  p_stripe_invoice_id text,
  p_event_kind text,
  p_stripe_object_id text,
  p_dispute_status text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_effective_status text;
begin
  if p_event_kind not in ('refund', 'credit_note', 'dispute') then
    raise exception 'AFFILIATE_INVALID_INVOICE_EVENT_KIND';
  end if;
  if p_event_kind = 'dispute' and p_dispute_status not in ('open', 'won', 'lost') then
    raise exception 'AFFILIATE_INVALID_DISPUTE_STATUS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_stripe_invoice_id, 1));

  insert into public.affiliate_invoice_events (
    stripe_invoice_id,
    event_kind,
    stripe_object_id,
    dispute_status
  )
  values (
    p_stripe_invoice_id,
    p_event_kind,
    p_stripe_object_id,
    p_dispute_status
  )
  on conflict (event_kind, stripe_object_id) do update
  set dispute_status = case
        when public.affiliate_invoice_events.dispute_status in ('won', 'lost')
          then public.affiliate_invoice_events.dispute_status
        when excluded.dispute_status in ('won', 'lost')
          then excluded.dispute_status
        else public.affiliate_invoice_events.dispute_status
      end
  where public.affiliate_invoice_events.stripe_invoice_id = excluded.stripe_invoice_id
  returning id, dispute_status into v_event_id, v_effective_status;

  if v_event_id is null then
    raise exception 'AFFILIATE_INVOICE_EVENT_ID_COLLISION';
  end if;

  return public.reconcile_affiliate_commission(
    p_stripe_invoice_id,
    p_event_kind || ':' || p_stripe_object_id || ':' || coalesce(v_effective_status, 'recorded')
  );
end;
$$;

create or replace function public.record_affiliate_commission(
  p_subscriber_user_id uuid,
  p_stripe_invoice_id text,
  p_stripe_subscription_id text,
  p_stripe_event_id text,
  p_paid_at timestamptz,
  p_billing_period_start timestamptz default null,
  p_billing_period_end timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attribution record;
  v_existing public.affiliate_commissions%rowtype;
  v_commission_id uuid;
  v_initial_status text := 'pending';
  v_reversal_reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_stripe_invoice_id, 1));

  select aa.affiliate_id, a.user_id as affiliate_user_id
  into v_attribution
  from public.affiliate_attributions aa
  join public.affiliates a on a.id = aa.affiliate_id
  where aa.subscriber_user_id = p_subscriber_user_id
    and aa.status = 'active'
    and a.status = 'active'
  for update of aa, a;

  if not found or v_attribution.affiliate_user_id = p_subscriber_user_id then
    return null;
  end if;

  if exists (
    select 1
    from public.affiliate_invoice_events
    where stripe_invoice_id = p_stripe_invoice_id
      and (
        event_kind in ('refund', 'credit_note')
        or (event_kind = 'dispute' and dispute_status = 'lost')
      )
  ) then
    v_initial_status := 'reversed';
    v_reversal_reason := 'invoice_reversed';
  elsif exists (
    select 1
    from public.affiliate_invoice_events
    where stripe_invoice_id = p_stripe_invoice_id
      and event_kind = 'dispute'
      and dispute_status = 'open'
  ) then
    v_initial_status := 'held';
    v_reversal_reason := 'open_dispute';
  end if;

  insert into public.affiliate_commissions (
    affiliate_id,
    subscriber_user_id,
    stripe_invoice_id,
    stripe_subscription_id,
    stripe_event_id,
    billing_period_start,
    billing_period_end,
    amount_cents,
    status,
    available_at,
    reversal_reason
  )
  values (
    v_attribution.affiliate_id,
    p_subscriber_user_id,
    p_stripe_invoice_id,
    p_stripe_subscription_id,
    p_stripe_event_id,
    p_billing_period_start,
    p_billing_period_end,
    100,
    v_initial_status,
    p_paid_at + interval '30 days',
    v_reversal_reason
  )
  on conflict (stripe_invoice_id) do nothing
  returning id into v_commission_id;

  if v_commission_id is null then
    select *
    into v_existing
    from public.affiliate_commissions
    where stripe_invoice_id = p_stripe_invoice_id
    for update;

    if v_existing.affiliate_id <> v_attribution.affiliate_id
       or v_existing.subscriber_user_id <> p_subscriber_user_id
       or v_existing.stripe_subscription_id <> p_stripe_subscription_id
       or v_existing.amount_cents <> 100
       or v_existing.billing_period_start is distinct from p_billing_period_start
       or v_existing.billing_period_end is distinct from p_billing_period_end
       or v_existing.available_at is distinct from (p_paid_at + interval '30 days')
       or (
         v_existing.stripe_event_id is not null
         and p_stripe_event_id is not null
         and v_existing.stripe_event_id <> p_stripe_event_id
       ) then
      raise exception 'AFFILIATE_COMMISSION_ID_COLLISION';
    end if;

    if v_existing.stripe_event_id is null and p_stripe_event_id is not null then
      update public.affiliate_commissions
      set stripe_event_id = p_stripe_event_id
      where id = v_existing.id;
    end if;
    v_commission_id := v_existing.id;
  end if;

  return v_commission_id;
end;
$$;

create or replace function public.prepare_affiliate_payout(
  p_affiliate_id uuid,
  p_payout_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_payout public.affiliate_payouts%rowtype;
  v_gross integer;
  v_adjustments integer;
  v_count integer;
  v_net integer;
begin
  select *
  into v_affiliate
  from public.affiliates
  where id = p_affiliate_id
  for update;

  if not found then
    return null;
  end if;

  update public.affiliate_commissions
  set status = 'available'
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and available_at <= now();

  select *
  into v_payout
  from public.affiliate_payouts
  where affiliate_id = p_affiliate_id
    and payout_month = p_payout_month
  for update;

  if found and v_payout.status = 'paid' then
    return to_jsonb(v_payout) || jsonb_build_object(
      'stripe_connect_account_id', v_affiliate.stripe_connect_account_id,
      'already_paid', true
    );
  end if;

  if found and v_payout.status = 'processing' then
    return to_jsonb(v_payout) || jsonb_build_object(
      'stripe_connect_account_id', v_affiliate.stripe_connect_account_id,
      'already_paid', false
    );
  end if;

  if v_affiliate.status <> 'active'
     or v_affiliate.stripe_transfers_status <> 'active'
     or v_affiliate.recipient_payouts_status <> 'active'
     or v_affiliate.requirements_status = 'past_due'
     or v_affiliate.stripe_connect_account_id is null then
    return null;
  end if;

  select coalesce(sum(amount_cents), 0), count(*)
  into v_gross, v_count
  from public.affiliate_commissions
  where affiliate_id = p_affiliate_id
    and status = 'available'
    and payout_id is null;

  select coalesce(sum(amount_cents), 0)
  into v_adjustments
  from public.affiliate_adjustments
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and payout_id is null;

  v_net := v_gross + v_adjustments;
  if v_net <= 0 then
    return null;
  end if;

  if v_payout.id is null then
    insert into public.affiliate_payouts (
      affiliate_id,
      payout_month,
      gross_amount_cents,
      adjustment_amount_cents,
      net_amount_cents,
      commission_count,
      status
    )
    values (
      p_affiliate_id,
      p_payout_month,
      v_gross,
      v_adjustments,
      v_net,
      v_count,
      'processing'
    )
    returning * into v_payout;
  else
    update public.affiliate_payouts
    set gross_amount_cents = v_gross,
        adjustment_amount_cents = v_adjustments,
        net_amount_cents = v_net,
        commission_count = v_count,
        status = 'processing',
        failure_message = null
    where id = v_payout.id
    returning * into v_payout;
  end if;

  update public.affiliate_commissions
  set payout_id = v_payout.id
  where affiliate_id = p_affiliate_id
    and status = 'available'
    and payout_id is null;

  update public.affiliate_adjustments
  set payout_id = v_payout.id
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and payout_id is null;

  return to_jsonb(v_payout) || jsonb_build_object(
    'stripe_connect_account_id', v_affiliate.stripe_connect_account_id,
    'already_paid', false
  );
end;
$$;

create or replace function public.complete_affiliate_payout(
  p_payout_id uuid,
  p_stripe_transfer_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.affiliate_payouts
  set status = 'paid',
      stripe_transfer_id = p_stripe_transfer_id,
      paid_at = now(),
      failure_message = null
  where id = p_payout_id
    and status = 'processing';

  if not found then
    raise exception 'AFFILIATE_PAYOUT_NOT_PROCESSING';
  end if;

  update public.affiliate_commissions
  set status = 'paid',
      paid_at = now()
  where payout_id = p_payout_id
    and status = 'available';

  update public.affiliate_adjustments
  set status = 'applied',
      applied_at = now()
  where payout_id = p_payout_id
    and status = 'pending';
end;
$$;

create or replace function public.fail_affiliate_payout(
  p_payout_id uuid,
  p_failure_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.affiliate_commissions
  set payout_id = null
  where payout_id = p_payout_id
    and status = 'available';

  update public.affiliate_adjustments
  set payout_id = null
  where payout_id = p_payout_id
    and status = 'pending';

  update public.affiliate_payouts
  set status = 'failed',
      failure_message = left(coalesce(p_failure_message, 'Transfer failed'), 300)
  where id = p_payout_id
    and status = 'processing';
end;
$$;

create or replace function public.prepare_affiliate_payout(
  p_affiliate_id uuid,
  p_payout_month date,
  p_claim_token uuid,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_affiliate public.affiliates%rowtype;
  v_payout public.affiliate_payouts%rowtype;
  v_cutoff timestamptz := clock_timestamp();
  v_eligibility_cutoff timestamptz;
  v_gross integer;
  v_adjustments integer;
  v_count integer;
  v_net integer;
  v_claimed_gross integer;
  v_claimed_adjustments integer;
  v_claimed_count integer;
begin
  if p_claim_token is null or p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'AFFILIATE_INVALID_PAYOUT_LEASE';
  end if;
  if p_payout_month <> date_trunc('month', p_payout_month)::date then
    raise exception 'AFFILIATE_INVALID_PAYOUT_MONTH';
  end if;
  if p_payout_month > date_trunc('month', now())::date then
    raise exception 'AFFILIATE_FUTURE_PAYOUT_MONTH';
  end if;
  v_eligibility_cutoff := least(
    v_cutoff,
    (p_payout_month + interval '1 month')::timestamptz
  );

  select *
  into v_affiliate
  from public.affiliates
  where id = p_affiliate_id
  for update;

  if not found then
    return null;
  end if;

  select *
  into v_payout
  from public.affiliate_payouts
  where affiliate_id = p_affiliate_id
    and payout_month = p_payout_month
  for update;

  if found and v_payout.status = 'paid' then
    return to_jsonb(v_payout) || jsonb_build_object('already_paid', true);
  end if;

  if found and v_payout.status = 'processing' then
    if v_payout.claim_token is distinct from p_claim_token
       and v_payout.lease_expires_at > now() then
      return null;
    end if;

    update public.affiliate_payouts
    set claim_token = p_claim_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = v_payout.id
    returning * into v_payout;

    return to_jsonb(v_payout) || jsonb_build_object(
      'already_paid', false,
      'resumed', true
    );
  end if;

  if v_affiliate.status <> 'active'
     or v_affiliate.stripe_transfers_status <> 'active'
     or v_affiliate.recipient_payouts_status <> 'active'
     or v_affiliate.requirements_status = 'past_due'
     or v_affiliate.stripe_connect_account_id is null then
    return null;
  end if;

  update public.affiliate_commissions
  set status = 'available'
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and available_at <= now();

  select coalesce(sum(amount_cents), 0), count(*)
  into v_gross, v_count
  from public.affiliate_commissions
  where affiliate_id = p_affiliate_id
    and status = 'available'
    and payout_id is null
    and available_at < (p_payout_month + interval '1 month')::timestamptz
    and created_at <= v_eligibility_cutoff;

  select coalesce(sum(amount_cents), 0)
  into v_adjustments
  from public.affiliate_adjustments
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and payout_id is null
    and created_at <= v_eligibility_cutoff;

  v_net := v_gross + v_adjustments;
  if v_net <= 0 then
    return null;
  end if;

  if v_payout.id is null then
    insert into public.affiliate_payouts (
      affiliate_id,
      payout_month,
      gross_amount_cents,
      adjustment_amount_cents,
      net_amount_cents,
      commission_count,
      status,
      stripe_destination_account_id,
      claim_token,
      lease_expires_at
    )
    values (
      p_affiliate_id,
      p_payout_month,
      v_gross,
      v_adjustments,
      v_net,
      v_count,
      'processing',
      v_affiliate.stripe_connect_account_id,
      p_claim_token,
      now() + make_interval(secs => p_lease_seconds)
    )
    returning * into v_payout;
  else
    if v_payout.transfer_request_started_at is not null then
      raise exception 'AFFILIATE_FAILED_PAYOUT_HAS_TRANSFER_REQUEST';
    end if;
    update public.affiliate_payouts
    set gross_amount_cents = v_gross,
        adjustment_amount_cents = v_adjustments,
        net_amount_cents = v_net,
        commission_count = v_count,
        status = 'processing',
        stripe_destination_account_id = v_affiliate.stripe_connect_account_id,
        claim_token = p_claim_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        transfer_failure_confirmed_at = null,
        failure_message = null
    where id = v_payout.id
    returning * into v_payout;
  end if;

  update public.affiliate_commissions
  set payout_id = v_payout.id,
      status = 'processing'
  where affiliate_id = p_affiliate_id
    and status = 'available'
    and payout_id is null
    and available_at < (p_payout_month + interval '1 month')::timestamptz
    and created_at <= v_eligibility_cutoff;

  update public.affiliate_adjustments
  set payout_id = v_payout.id,
      status = 'processing'
  where affiliate_id = p_affiliate_id
    and status = 'pending'
    and payout_id is null
    and created_at <= v_eligibility_cutoff;

  select coalesce(sum(amount_cents), 0), count(*)
  into v_claimed_gross, v_claimed_count
  from public.affiliate_commissions
  where payout_id = v_payout.id
    and status = 'processing';

  select coalesce(sum(amount_cents), 0)
  into v_claimed_adjustments
  from public.affiliate_adjustments
  where payout_id = v_payout.id
    and status = 'processing';

  if v_claimed_gross <> v_payout.gross_amount_cents
     or v_claimed_adjustments <> v_payout.adjustment_amount_cents
     or v_claimed_count <> v_payout.commission_count then
    raise exception 'AFFILIATE_PAYOUT_SNAPSHOT_MISMATCH';
  end if;

  return to_jsonb(v_payout) || jsonb_build_object(
    'already_paid', false,
    'resumed', false
  );
end;
$$;

create or replace function public.mark_affiliate_payout_transfer_started(
  p_payout_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.affiliate_payouts
  set transfer_request_started_at = coalesce(transfer_request_started_at, now()),
      lease_expires_at = now() + interval '5 minutes'
  where id = p_payout_id
    and status = 'processing'
    and claim_token = p_claim_token
    and (
      transfer_request_started_at is not null
      or exists (
        select 1
        from public.affiliates a
        where a.id = public.affiliate_payouts.affiliate_id
          and a.status = 'active'
          and a.stripe_transfers_status = 'active'
          and a.recipient_payouts_status = 'active'
          and a.requirements_status <> 'past_due'
      )
    );
  return found;
end;
$$;

create or replace function public.complete_affiliate_payout(
  p_payout_id uuid,
  p_claim_token uuid,
  p_stripe_transfer_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.affiliate_payouts%rowtype;
  v_gross integer;
  v_adjustments integer;
  v_count integer;
begin
  select *
  into v_payout
  from public.affiliate_payouts
  where id = p_payout_id
  for update;

  if not found
     or v_payout.status <> 'processing'
     or v_payout.claim_token is distinct from p_claim_token
     or v_payout.transfer_request_started_at is null then
    return false;
  end if;

  select coalesce(sum(amount_cents), 0), count(*)
  into v_gross, v_count
  from public.affiliate_commissions
  where payout_id = p_payout_id
    and status = 'processing';

  select coalesce(sum(amount_cents), 0)
  into v_adjustments
  from public.affiliate_adjustments
  where payout_id = p_payout_id
    and status = 'processing';

  if v_gross <> v_payout.gross_amount_cents
     or v_adjustments <> v_payout.adjustment_amount_cents
     or v_count <> v_payout.commission_count
     or v_gross + v_adjustments <> v_payout.net_amount_cents then
    raise exception 'AFFILIATE_PAYOUT_SNAPSHOT_MISMATCH';
  end if;

  update public.affiliate_commissions
  set status = 'paid',
      paid_at = now()
  where payout_id = p_payout_id
    and status = 'processing';

  update public.affiliate_adjustments
  set status = 'applied',
      applied_at = now()
  where payout_id = p_payout_id
    and status = 'processing';

  update public.affiliate_payouts
  set status = 'paid',
      stripe_transfer_id = p_stripe_transfer_id,
      paid_at = now(),
      failure_message = null,
      claim_token = null,
      lease_expires_at = null
  where id = p_payout_id;

  return true;
end;
$$;

create or replace function public.fail_affiliate_payout(
  p_payout_id uuid,
  p_claim_token uuid,
  p_failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.affiliate_payouts%rowtype;
  v_invoice_ids text[];
  v_invoice_id text;
begin
  select *
  into v_payout
  from public.affiliate_payouts
  where id = p_payout_id
  for update;

  if not found
     or v_payout.status <> 'processing'
     or v_payout.claim_token is distinct from p_claim_token
     or v_payout.transfer_request_started_at is not null then
    return false;
  end if;

  select coalesce(array_agg(stripe_invoice_id), array[]::text[])
  into v_invoice_ids
  from public.affiliate_commissions
  where payout_id = p_payout_id
    and status = 'processing';

  update public.affiliate_commissions
  set payout_id = null,
      status = 'available'
  where payout_id = p_payout_id
    and status = 'processing';

  update public.affiliate_adjustments
  set payout_id = null,
      status = 'pending'
  where payout_id = p_payout_id
    and status = 'processing';

  update public.affiliate_payouts
  set status = 'failed',
      failure_message = left(coalesce(p_failure_message, 'Transfer failed'), 300),
      claim_token = null,
      lease_expires_at = null
  where id = p_payout_id;

  foreach v_invoice_id in array v_invoice_ids loop
    perform public.reconcile_affiliate_commission(
      v_invoice_id,
      'payout-failed:' || p_payout_id::text
    );
  end loop;

  return true;
end;
$$;

create or replace function public.fail_affiliate_payout_after_reconciliation(
  p_payout_id uuid,
  p_claim_token uuid,
  p_failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.affiliate_payouts
  set transfer_request_started_at = null,
      transfer_failure_confirmed_at = now()
  where id = p_payout_id
    and status = 'processing'
    and claim_token = p_claim_token
    and transfer_request_started_at is not null;

  if not found then
    return false;
  end if;

  return public.fail_affiliate_payout(
    p_payout_id,
    p_claim_token,
    p_failure_message
  );
end;
$$;

create or replace function public.get_affiliate_active_supporter_count(
  p_affiliate_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.affiliate_attributions aa
  join public.subscriptions s
    on s.user_id = aa.subscriber_user_id
  where aa.affiliate_id = p_affiliate_id
    and aa.status = 'active'
    and s.status = 'active';
$$;

drop function public.reverse_affiliate_commission(text, text, text, text);
drop function public.hold_affiliate_commission_for_dispute(text, text);
drop function public.resolve_affiliate_commission_dispute(text, text, boolean);
drop function public.prepare_affiliate_payout(uuid, date);
drop function public.complete_affiliate_payout(uuid, text);
drop function public.fail_affiliate_payout(uuid, text);

revoke all on function public.claim_stripe_webhook_event(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_stripe_webhook_event(text, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_stripe_webhook_event(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_affiliate_attribution(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_affiliate_commission(uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reconcile_affiliate_commission(text, text)
  from public, anon, authenticated;
revoke all on function public.record_affiliate_invoice_event(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.prepare_affiliate_payout(uuid, date, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.mark_affiliate_payout_transfer_started(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_affiliate_payout(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_affiliate_payout(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_affiliate_payout_after_reconciliation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_affiliate_active_supporter_count(uuid)
  from public, anon, authenticated;
revoke all on function public.set_row_updated_at()
  from public, anon, authenticated;

grant execute on function public.claim_stripe_webhook_event(text, text, text, integer)
  to service_role;
grant execute on function public.complete_stripe_webhook_event(text, uuid)
  to service_role;
grant execute on function public.fail_stripe_webhook_event(text, uuid, text)
  to service_role;
grant execute on function public.create_affiliate_attribution(uuid, text)
  to service_role;
grant execute on function public.record_affiliate_commission(uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
grant execute on function public.record_affiliate_invoice_event(text, text, text, text)
  to service_role;
grant execute on function public.prepare_affiliate_payout(uuid, date, uuid, integer)
  to service_role;
grant execute on function public.mark_affiliate_payout_transfer_started(uuid, uuid)
  to service_role;
grant execute on function public.complete_affiliate_payout(uuid, uuid, text)
  to service_role;
grant execute on function public.fail_affiliate_payout(uuid, uuid, text)
  to service_role;
grant execute on function public.fail_affiliate_payout_after_reconciliation(uuid, uuid, text)
  to service_role;
grant execute on function public.get_affiliate_active_supporter_count(uuid)
  to service_role;

commit;
