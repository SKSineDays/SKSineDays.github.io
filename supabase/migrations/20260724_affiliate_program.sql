begin;

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
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
  failure_message text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliate_id, payout_month)
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
    check (status in ('pending', 'available', 'paid', 'reversed', 'held')),
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
    check (status in ('pending', 'applied', 'waived')),
  payout_id uuid references public.affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create unique index affiliate_adjustments_one_refund_debit_idx
  on public.affiliate_adjustments (commission_id)
  where amount_cents < 0 and reason in ('refund', 'partial_refund');
create index affiliate_adjustments_affiliate_status_idx
  on public.affiliate_adjustments (affiliate_id, status);
create index affiliate_adjustments_payout_idx
  on public.affiliate_adjustments (payout_id)
  where payout_id is not null;

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  source text not null check (source in ('billing', 'connect')),
  status text not null check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
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

drop trigger if exists trg_stripe_webhook_events_updated_at on public.stripe_webhook_events;
create trigger trg_stripe_webhook_events_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_row_updated_at();

alter table public.affiliates enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_adjustments enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.affiliates from anon, authenticated;
revoke all on public.affiliate_attributions from anon, authenticated;
revoke all on public.affiliate_commissions from anon, authenticated;
revoke all on public.affiliate_adjustments from anon, authenticated;
revoke all on public.affiliate_payouts from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

grant select on public.affiliates to authenticated;
grant select on public.affiliate_attributions to authenticated;
grant all on public.affiliates to service_role;
grant all on public.affiliate_attributions to service_role;
grant all on public.affiliate_commissions to service_role;
grant all on public.affiliate_adjustments to service_role;
grant all on public.affiliate_payouts to service_role;
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
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.stripe_webhook_events%rowtype;
begin
  if p_source not in ('billing', 'connect') then
    raise exception 'INVALID_WEBHOOK_SOURCE';
  end if;

  insert into public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    source,
    status
  )
  values (
    p_stripe_event_id,
    p_event_type,
    p_source,
    'processing'
  )
  on conflict (stripe_event_id) do nothing;

  if found then
    return 'process';
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
    return 'duplicate';
  end if;

  if v_event.status = 'processing'
     and v_event.updated_at > now() - make_interval(secs => p_recovery_timeout_seconds) then
    return 'busy';
  end if;

  update public.stripe_webhook_events
  set status = 'processing',
      attempts = attempts + 1,
      last_error = null,
      processed_at = null
  where stripe_event_id = p_stripe_event_id;

  return 'process';
end;
$$;

create or replace function public.complete_stripe_webhook_event(
  p_stripe_event_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_webhook_events
  set status = 'processed',
      processed_at = now(),
      last_error = null
  where stripe_event_id = p_stripe_event_id
    and status = 'processing';
$$;

create or replace function public.fail_stripe_webhook_event(
  p_stripe_event_id text,
  p_last_error text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.stripe_webhook_events
  set status = 'failed',
      last_error = left(coalesce(p_last_error, 'Processing failed'), 500)
  where stripe_event_id = p_stripe_event_id
    and status = 'processing';
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
  select status
  into v_subscription_status
  from public.subscriptions
  where user_id = p_subscriber_user_id;

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

  if not found
     or v_affiliate.status <> 'active'
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

revoke all on function public.claim_stripe_webhook_event(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_stripe_webhook_event(text)
  from public, anon, authenticated;
revoke all on function public.fail_stripe_webhook_event(text, text)
  from public, anon, authenticated;
revoke all on function public.create_affiliate_attribution(uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_affiliate_commission(uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reverse_affiliate_commission(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.hold_affiliate_commission_for_dispute(text, text)
  from public, anon, authenticated;
revoke all on function public.resolve_affiliate_commission_dispute(text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.prepare_affiliate_payout(uuid, date)
  from public, anon, authenticated;
revoke all on function public.complete_affiliate_payout(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_affiliate_payout(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_affiliate_active_supporter_count(uuid)
  from public, anon, authenticated;

grant execute on function public.claim_stripe_webhook_event(text, text, text, integer)
  to service_role;
grant execute on function public.complete_stripe_webhook_event(text)
  to service_role;
grant execute on function public.fail_stripe_webhook_event(text, text)
  to service_role;
grant execute on function public.create_affiliate_attribution(uuid, text)
  to service_role;
grant execute on function public.record_affiliate_commission(uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
grant execute on function public.reverse_affiliate_commission(text, text, text, text)
  to service_role;
grant execute on function public.hold_affiliate_commission_for_dispute(text, text)
  to service_role;
grant execute on function public.resolve_affiliate_commission_dispute(text, text, boolean)
  to service_role;
grant execute on function public.prepare_affiliate_payout(uuid, date)
  to service_role;
grant execute on function public.complete_affiliate_payout(uuid, text)
  to service_role;
grant execute on function public.fail_affiliate_payout(uuid, text)
  to service_role;
grant execute on function public.get_affiliate_active_supporter_count(uuid)
  to service_role;

commit;
