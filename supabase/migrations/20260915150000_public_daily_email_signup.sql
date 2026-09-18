-- Public Daily SineDay double opt-in, durable abuse controls, and atomic activation.
-- All tables and RPCs in this migration are service-role-only.

begin;

do $$
begin
  if pg_catalog.to_regclass('public.subscribers') is null
    or pg_catalog.to_regclass('public.subscriber_preferences') is null
    or pg_catalog.to_regclass('public.subscriber_profile') is null then
    raise exception 'Public mailer signup requires the existing subscriber tables';
  end if;
end;
$$;

alter table public.subscribers
  add column if not exists email_unsubscribed_at timestamptz;

alter table public.subscriber_preferences
  add column if not exists email_consent_version text,
  add column if not exists email_consent_recorded_at timestamptz;

alter table public.subscribers enable row level security;
alter table public.subscriber_preferences enable row level security;
alter table public.subscriber_profile enable row level security;
alter table public.delivery_log enable row level security;

revoke all on table public.subscribers from public, anon, authenticated;
revoke all on table public.subscriber_preferences from public, anon, authenticated;
revoke all on table public.subscriber_profile from public, anon, authenticated;
revoke all on table public.delivery_log from public, anon, authenticated;

grant select, insert, update, delete on table public.subscribers to service_role;
grant select, insert, update, delete on table public.subscriber_preferences to service_role;
grant select, insert, update, delete on table public.subscriber_profile to service_role;
grant select, insert, update, delete on table public.delivery_log to service_role;

update public.subscribers
set email_unsubscribed_at = coalesce(email_unsubscribed_at, updated_at, pg_catalog.now())
where status = 'unsubscribed'
  and email_unsubscribed_at is null;

create table public.mailer_signup_requests (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  recipient_key_hash text not null,
  email text,
  timezone text,
  birth_day_of_year smallint,
  origin_day smallint,
  consent_version text not null,
  consented_at timestamptz not null,
  source text not null,
  status text not null default 'created',
  expires_at timestamptz not null,
  confirmation_provider_message_id text,
  provider_status text,
  provider_event_at timestamptz,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  confirmation_sent_at timestamptz,
  consumed_at timestamptz,
  payload_cleared_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint mailer_signup_requests_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mailer_signup_requests_recipient_hash_check
    check (recipient_key_hash ~ '^[0-9a-f]{64}$'),
  constraint mailer_signup_requests_email_check
    check (
      email is null
      or (
        email = pg_catalog.lower(pg_catalog.btrim(email))
        and pg_catalog.char_length(email) between 3 and 320
      )
    ),
  constraint mailer_signup_requests_timezone_check
    check (timezone is null or pg_catalog.char_length(timezone) between 1 and 255),
  constraint mailer_signup_requests_birth_day_check
    check (birth_day_of_year is null or birth_day_of_year between 1 and 366),
  constraint mailer_signup_requests_origin_day_check
    check (origin_day is null or origin_day between 1 and 18),
  constraint mailer_signup_requests_source_check
    check (source in ('public-daily-page', 'homepage-banner')),
  constraint mailer_signup_requests_status_check
    check (
      status in (
        'created',
        'pending',
        'consumed',
        'expired',
        'send_failed',
        'suppressed',
        'invalidated'
      )
    ),
  constraint mailer_signup_requests_pending_payload_check
    check (
      status not in ('created', 'pending')
      or (
        email is not null
        and timezone is not null
        and birth_day_of_year is not null
        and origin_day is not null
      )
    )
);

create unique index mailer_signup_requests_provider_message_uidx
  on public.mailer_signup_requests (confirmation_provider_message_id)
  where confirmation_provider_message_id is not null;

create index mailer_signup_requests_expiry_idx
  on public.mailer_signup_requests (expires_at)
  where status in ('created', 'pending');

create index mailer_signup_requests_email_pending_idx
  on public.mailer_signup_requests (email, created_at desc)
  where email is not null and status in ('created', 'pending');

create table public.mailer_signup_attempts (
  id bigint generated always as identity primary key,
  request_id uuid references public.mailer_signup_requests(id) on delete set null,
  recipient_key_hash text not null,
  ip_key_hash text not null,
  outcome text not null,
  attempted_at timestamptz not null default pg_catalog.now(),
  constraint mailer_signup_attempts_recipient_hash_check
    check (recipient_key_hash ~ '^[0-9a-f]{64}$'),
  constraint mailer_signup_attempts_ip_hash_check
    check (ip_key_hash ~ '^[0-9a-f]{64}$'),
  constraint mailer_signup_attempts_outcome_check
    check (outcome in ('created', 'sent', 'send_failed', 'cooldown', 'rate_limited'))
);

create index mailer_signup_attempts_recipient_time_idx
  on public.mailer_signup_attempts (recipient_key_hash, attempted_at desc);

create index mailer_signup_attempts_ip_time_idx
  on public.mailer_signup_attempts (ip_key_hash, attempted_at desc);

create index mailer_signup_attempts_time_idx
  on public.mailer_signup_attempts (attempted_at);

create table public.mailer_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text,
  recipient_key_hash text,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  reason text not null,
  provider_message_id text,
  provider_event_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint mailer_suppressions_email_check
    check (
      email is null
      or (
        email = pg_catalog.lower(pg_catalog.btrim(email))
        and pg_catalog.char_length(email) between 3 and 320
      )
    ),
  constraint mailer_suppressions_recipient_hash_check
    check (
      recipient_key_hash is null
      or recipient_key_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint mailer_suppressions_reason_check
    check (reason in ('email.bounced', 'email.complained', 'email.suppressed')),
  constraint mailer_suppressions_identifier_check
    check (email is not null or recipient_key_hash is not null)
);

create unique index mailer_suppressions_email_uidx
  on public.mailer_suppressions (email)
  where email is not null;

create unique index mailer_suppressions_recipient_hash_uidx
  on public.mailer_suppressions (recipient_key_hash)
  where recipient_key_hash is not null;

create table public.mailer_welcome_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null unique references public.subscribers(id) on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.now(),
  provider_message_id text,
  provider_status text,
  provider_event_at timestamptz,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint mailer_welcome_deliveries_status_check
    check (status in ('pending', 'processing', 'failed', 'sent', 'cancelled')),
  constraint mailer_welcome_deliveries_attempt_count_check
    check (attempt_count between 0 and 5)
);

create unique index mailer_welcome_deliveries_provider_message_uidx
  on public.mailer_welcome_deliveries (provider_message_id)
  where provider_message_id is not null;

create index mailer_welcome_deliveries_due_idx
  on public.mailer_welcome_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

alter table public.mailer_signup_requests enable row level security;
alter table public.mailer_signup_attempts enable row level security;
alter table public.mailer_suppressions enable row level security;
alter table public.mailer_welcome_deliveries enable row level security;

revoke all on table public.mailer_signup_requests from public, anon, authenticated;
revoke all on table public.mailer_signup_attempts from public, anon, authenticated;
revoke all on table public.mailer_suppressions from public, anon, authenticated;
revoke all on table public.mailer_welcome_deliveries from public, anon, authenticated;
revoke all on sequence public.mailer_signup_attempts_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.mailer_signup_requests to service_role;
grant select, insert, update, delete on table public.mailer_signup_attempts to service_role;
grant select, insert, update, delete on table public.mailer_suppressions to service_role;
grant select, insert, update, delete on table public.mailer_welcome_deliveries to service_role;
grant usage, select on sequence public.mailer_signup_attempts_id_seq to service_role;

create or replace function public.cleanup_mailer_signup_requests()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.mailer_signup_requests
  set status = 'expired',
      email = null,
      timezone = null,
      birth_day_of_year = null,
      origin_day = null,
      payload_cleared_at = coalesce(payload_cleared_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where status in ('created', 'pending')
    and expires_at <= pg_catalog.clock_timestamp();

  delete from public.mailer_signup_attempts
  where attempted_at < (pg_catalog.clock_timestamp() - interval '30 days');
end;
$$;

create or replace function public.create_mailer_signup_request(
  p_token_hash text,
  p_email text,
  p_timezone text,
  p_birth_day_of_year smallint,
  p_origin_day smallint,
  p_consent_version text,
  p_source text,
  p_recipient_key_hash text,
  p_ip_key_hash text
)
returns table (
  result_state text,
  request_id uuid,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_id uuid;
  v_last_sent timestamptz;
  v_recipient_attempts integer;
  v_ip_hour_attempts integer;
  v_ip_day_attempts integer;
  v_retry_after integer := 60;
  v_reset_at timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_recipient_key_hash is null or p_recipient_key_hash !~ '^[0-9a-f]{64}$'
    or p_ip_key_hash is null or p_ip_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_hash';
  end if;
  if p_email is null
    or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
    or pg_catalog.char_length(p_email) not between 3 and 320
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  if p_timezone is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone
    ) then
    raise exception 'invalid_timezone';
  end if;
  if p_birth_day_of_year not between 1 and 366
    or p_origin_day not between 1 and 18 then
    raise exception 'invalid_rhythm';
  end if;
  if p_source not in ('public-daily-page', 'homepage-banner') then
    raise exception 'invalid_source';
  end if;
  if p_consent_version is null
    or pg_catalog.char_length(pg_catalog.btrim(p_consent_version)) not between 1 and 100 then
    raise exception 'invalid_consent';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_recipient_key_hash, 7721)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_ip_key_hash, 7722)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_email, 7723)
  );
  perform public.cleanup_mailer_signup_requests();

  if exists (
    select 1
    from public.mailer_suppressions s
    where s.email = p_email
      or s.recipient_key_hash = p_recipient_key_hash
  ) then
    return query select 'suppressed'::text, null::uuid, 0;
    return;
  end if;

  select pg_catalog.max(a.attempted_at)
  into v_last_sent
  from public.mailer_signup_attempts a
  where a.recipient_key_hash = p_recipient_key_hash
    and a.outcome in ('created', 'sent');

  select pg_catalog.count(*)::integer
  into v_recipient_attempts
  from public.mailer_signup_attempts a
  where a.recipient_key_hash = p_recipient_key_hash
    and a.outcome in ('created', 'sent', 'send_failed')
    and a.attempted_at >= v_now - interval '24 hours';

  select pg_catalog.count(*)::integer
  into v_ip_hour_attempts
  from public.mailer_signup_attempts a
  where a.ip_key_hash = p_ip_key_hash
    and a.outcome in ('created', 'sent', 'send_failed')
    and a.attempted_at >= v_now - interval '1 hour';

  select pg_catalog.count(*)::integer
  into v_ip_day_attempts
  from public.mailer_signup_attempts a
  where a.ip_key_hash = p_ip_key_hash
    and a.outcome in ('created', 'sent', 'send_failed')
    and a.attempted_at >= v_now - interval '24 hours';

  if v_recipient_attempts >= 5
    or v_ip_hour_attempts >= 20
    or v_ip_day_attempts >= 100 then
    if v_recipient_attempts >= 5 then
      select pg_catalog.min(a.attempted_at) + interval '24 hours'
      into v_reset_at
      from public.mailer_signup_attempts a
      where a.recipient_key_hash = p_recipient_key_hash
        and a.outcome in ('created', 'sent', 'send_failed')
        and a.attempted_at >= v_now - interval '24 hours';
      v_retry_after := greatest(
        v_retry_after,
        pg_catalog.ceil(pg_catalog.extract(epoch from (v_reset_at - v_now)))::integer
      );
    end if;
    if v_ip_hour_attempts >= 20 then
      select pg_catalog.min(a.attempted_at) + interval '1 hour'
      into v_reset_at
      from public.mailer_signup_attempts a
      where a.ip_key_hash = p_ip_key_hash
        and a.outcome in ('created', 'sent', 'send_failed')
        and a.attempted_at >= v_now - interval '1 hour';
      v_retry_after := greatest(
        v_retry_after,
        pg_catalog.ceil(pg_catalog.extract(epoch from (v_reset_at - v_now)))::integer
      );
    end if;
    if v_ip_day_attempts >= 100 then
      select pg_catalog.min(a.attempted_at) + interval '24 hours'
      into v_reset_at
      from public.mailer_signup_attempts a
      where a.ip_key_hash = p_ip_key_hash
        and a.outcome in ('created', 'sent', 'send_failed')
        and a.attempted_at >= v_now - interval '24 hours';
      v_retry_after := greatest(
        v_retry_after,
        pg_catalog.ceil(pg_catalog.extract(epoch from (v_reset_at - v_now)))::integer
      );
    end if;
    return query select 'rate_limited'::text, null::uuid, v_retry_after;
    return;
  end if;

  if v_last_sent is not null and v_last_sent > v_now - interval '10 minutes' then
    return query select
      'cooldown'::text,
      null::uuid,
      greatest(
        60,
        pg_catalog.ceil(
          pg_catalog.extract(epoch from ((v_last_sent + interval '10 minutes') - v_now))
        )::integer
      );
    return;
  end if;

  insert into public.mailer_signup_requests (
    token_hash,
    recipient_key_hash,
    email,
    timezone,
    birth_day_of_year,
    origin_day,
    consent_version,
    consented_at,
    source,
    status,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_token_hash,
    p_recipient_key_hash,
    p_email,
    p_timezone,
    p_birth_day_of_year,
    p_origin_day,
    p_consent_version,
    v_now,
    p_source,
    'created',
    v_now + interval '24 hours',
    v_now,
    v_now
  )
  returning id into v_request_id;

  insert into public.mailer_signup_attempts (
    request_id,
    recipient_key_hash,
    ip_key_hash,
    outcome,
    attempted_at
  ) values (
    v_request_id,
    p_recipient_key_hash,
    p_ip_key_hash,
    'created',
    v_now
  );

  return query select 'created'::text, v_request_id, 0;
end;
$$;

create or replace function public.mark_mailer_confirmation_sent(
  p_request_id uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_provider_message_id is null
    or pg_catalog.char_length(pg_catalog.btrim(p_provider_message_id)) not between 1 and 255 then
    raise exception 'invalid_provider_message_id';
  end if;

  update public.mailer_signup_requests
  set status = 'pending',
      confirmation_provider_message_id = p_provider_message_id,
      confirmation_sent_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_request_id
    and status = 'created'
    and expires_at > pg_catalog.clock_timestamp();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'request_not_sendable';
  end if;

  update public.mailer_signup_attempts
  set outcome = 'sent'
  where request_id = p_request_id
    and outcome = 'created';
end;
$$;

create or replace function public.mark_mailer_confirmation_failed(p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.mailer_signup_requests
  set status = 'send_failed',
      email = null,
      timezone = null,
      birth_day_of_year = null,
      origin_day = null,
      payload_cleared_at = coalesce(payload_cleared_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_request_id
    and status = 'created';

  update public.mailer_signup_attempts
  set outcome = 'send_failed'
  where request_id = p_request_id
    and outcome = 'created';
end;
$$;

create or replace function public.confirm_mailer_signup(p_token_hash text)
returns table (
  result_state text,
  subscriber_id uuid,
  timezone text,
  send_hour_local smallint,
  send_minute_local smallint
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request public.mailer_signup_requests%rowtype;
  v_subscriber public.subscribers%rowtype;
  v_subscriber_id uuid;
  v_timezone text;
  v_send_hour smallint;
  v_send_minute smallint;
  v_profile_birth smallint;
  v_profile_origin smallint;
  v_has_preferences boolean := false;
  v_first_activation boolean := false;
  v_lock_email text;
  v_lock_recipient_key_hash text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;

  select r.email, r.recipient_key_hash
  into v_lock_email, v_lock_recipient_key_hash
  from public.mailer_signup_requests r
  where r.token_hash = p_token_hash;

  if found and v_lock_recipient_key_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_lock_recipient_key_hash, 7721)
    );
  end if;
  if found and v_lock_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_lock_email, 7723)
    );
  end if;

  select r.*
  into v_request
  from public.mailer_signup_requests r
  where r.token_hash = p_token_hash
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;

  if v_request.status = 'consumed' then
    return query select 'already_used'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;
  if v_request.status = 'expired' then
    return query select 'expired'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;
  if v_request.status = 'suppressed' then
    return query select 'suppressed'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;
  if v_request.status not in ('created', 'pending')
    or v_request.email is null
    or v_request.timezone is null
    or v_request.birth_day_of_year is null
    or v_request.origin_day is null then
    return query select 'invalid'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;
  if v_request.expires_at <= v_now then
    update public.mailer_signup_requests
    set status = 'expired',
        email = null,
        timezone = null,
        birth_day_of_year = null,
        origin_day = null,
        payload_cleared_at = coalesce(payload_cleared_at, v_now),
        updated_at = v_now
    where id = v_request.id;
    return query select 'expired'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;

  if exists (
    select 1
    from public.mailer_suppressions s
    where s.email = v_request.email
      or s.recipient_key_hash = v_request.recipient_key_hash
  ) then
    update public.mailer_signup_requests
    set status = 'suppressed',
        email = null,
        timezone = null,
        birth_day_of_year = null,
        origin_day = null,
        payload_cleared_at = coalesce(payload_cleared_at, v_now),
        updated_at = v_now
    where id = v_request.id;
    return query select 'suppressed'::text, null::uuid, null::text, null::smallint, null::smallint;
    return;
  end if;

  select s.*
  into v_subscriber
  from public.subscribers s
  where s.email = v_request.email
  for update;

  if found then
    v_subscriber_id := v_subscriber.id;
    if v_subscriber.status = 'suppressed' then
      update public.mailer_signup_requests
      set status = 'suppressed',
          subscriber_id = v_subscriber_id,
          email = null,
          timezone = null,
          birth_day_of_year = null,
          origin_day = null,
          payload_cleared_at = coalesce(payload_cleared_at, v_now),
          updated_at = v_now
      where id = v_request.id;
      return query select 'suppressed'::text, null::uuid, null::text, null::smallint, null::smallint;
      return;
    end if;

    if v_subscriber.email_unsubscribed_at is not null
      and v_request.created_at <= v_subscriber.email_unsubscribed_at then
      update public.mailer_signup_requests
      set status = 'invalidated',
          subscriber_id = v_subscriber_id,
          email = null,
          timezone = null,
          birth_day_of_year = null,
          origin_day = null,
          payload_cleared_at = coalesce(payload_cleared_at, v_now),
          updated_at = v_now
      where id = v_request.id;
      return query select 'invalid'::text, null::uuid, null::text, null::smallint, null::smallint;
      return;
    end if;

    if v_subscriber.status = 'active' then
      v_timezone := v_subscriber.timezone;
    elsif v_subscriber.status = 'unsubscribed' then
      update public.subscribers
      set status = 'active',
          timezone = v_request.timezone,
          email_unsubscribed_at = null,
          updated_at = v_now
      where id = v_subscriber_id;
      v_timezone := v_request.timezone;
      v_first_activation := true;
    else
      update public.mailer_signup_requests
      set status = 'invalidated',
          subscriber_id = v_subscriber_id,
          email = null,
          timezone = null,
          birth_day_of_year = null,
          origin_day = null,
          payload_cleared_at = coalesce(payload_cleared_at, v_now),
          updated_at = v_now
      where id = v_request.id;
      return query select 'suppressed'::text, null::uuid, null::text, null::smallint, null::smallint;
      return;
    end if;
  else
    insert into public.subscribers (
      email,
      timezone,
      status,
      source
    ) values (
      v_request.email,
      v_request.timezone,
      'active',
      v_request.source
    )
    returning id into v_subscriber_id;
    v_timezone := v_request.timezone;
    v_first_activation := true;
  end if;

  select true, p.send_hour_local::smallint, p.send_minute_local::smallint
  into v_has_preferences, v_send_hour, v_send_minute
  from public.subscriber_preferences p
  where p.subscriber_id = v_subscriber_id
  for update;
  v_has_preferences := found;

  if not v_has_preferences then
    insert into public.subscriber_preferences (
      subscriber_id,
      email_enabled,
      sms_enabled,
      email_opt_in,
      sms_opt_in,
      email_opt_in_at,
      email_consent_version,
      email_consent_recorded_at,
      send_hour_local,
      send_minute_local,
      updated_at
    ) values (
      v_subscriber_id,
      true,
      false,
      true,
      false,
      v_now,
      v_request.consent_version,
      v_now,
      6,
      0,
      v_now
    );
    v_send_hour := 6;
    v_send_minute := 0;
  elsif v_subscriber.status = 'unsubscribed' then
    -- v_subscriber is the locked pre-update row, so this is the fresh re-opt-in path.
    update public.subscriber_preferences
    set email_enabled = true,
        email_opt_in = true,
        email_opt_in_at = v_now,
        email_consent_version = v_request.consent_version,
        email_consent_recorded_at = v_now,
        updated_at = v_now
    where subscriber_id = v_subscriber_id;
  end if;

  select p.birth_day_of_year::smallint, p.origin_day::smallint
  into v_profile_birth, v_profile_origin
  from public.subscriber_profile p
  where p.subscriber_id = v_subscriber_id
  for update;

  if not found then
    insert into public.subscriber_profile (
      subscriber_id,
      birth_day_of_year,
      origin_day,
      updated_at
    ) values (
      v_subscriber_id,
      v_request.birth_day_of_year,
      v_request.origin_day,
      v_now
    );
  elsif v_profile_birth is null or v_profile_origin is null then
    update public.subscriber_profile
    set birth_day_of_year = v_request.birth_day_of_year,
        origin_day = v_request.origin_day,
        updated_at = v_now
    where subscriber_id = v_subscriber_id;
  end if;

  if v_first_activation then
    insert into public.mailer_welcome_deliveries (
      subscriber_id,
      status,
      next_attempt_at,
      created_at,
      updated_at
    ) values (
      v_subscriber_id,
      'pending',
      v_now,
      v_now,
      v_now
    )
    on conflict (subscriber_id) do update
      set status = 'pending',
          attempt_count = 0,
          last_attempt_at = null,
          next_attempt_at = excluded.next_attempt_at,
          error = null,
          updated_at = excluded.updated_at
      where public.mailer_welcome_deliveries.status = 'cancelled'
        and public.mailer_welcome_deliveries.provider_message_id is null
        and public.mailer_welcome_deliveries.sent_at is null;
  end if;

  update public.mailer_signup_requests
  set status = 'consumed',
      subscriber_id = v_subscriber_id,
      consumed_at = v_now,
      email = null,
      timezone = null,
      birth_day_of_year = null,
      origin_day = null,
      payload_cleared_at = coalesce(payload_cleared_at, v_now),
      updated_at = v_now
  where id = v_request.id;

  return query select
    'active'::text,
    v_subscriber_id,
    v_timezone,
    v_send_hour,
    v_send_minute;
end;
$$;

create or replace function public.activate_authenticated_email_subscriber(
  p_email text,
  p_recipient_key_hash text,
  p_timezone text,
  p_birth_day_of_year smallint,
  p_origin_day smallint,
  p_consent_version text,
  p_source text
)
returns table (
  result_state text,
  subscriber_id uuid,
  profile_configured boolean,
  origin_day smallint
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_subscriber public.subscribers%rowtype;
  v_subscriber_id uuid;
  v_profile_birth smallint;
  v_profile_origin smallint;
  v_has_profile boolean := false;
  v_has_preferences boolean := false;
  v_is_new boolean := false;
begin
  if p_email is null
    or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
    or pg_catalog.char_length(p_email) not between 3 and 320
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  if p_recipient_key_hash is null
    or p_recipient_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_recipient_hash';
  end if;
  if p_timezone is null
    or not exists (
      select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_timezone
    ) then
    raise exception 'invalid_timezone';
  end if;
  if p_source <> 'dashboard-daily-duck'
    or p_consent_version is null
    or pg_catalog.char_length(pg_catalog.btrim(p_consent_version)) not between 1 and 100 then
    raise exception 'invalid_request';
  end if;
  if (p_birth_day_of_year is null) <> (p_origin_day is null)
    or (p_birth_day_of_year is not null and p_birth_day_of_year not between 1 and 366)
    or (p_origin_day is not null and p_origin_day not between 1 and 18) then
    raise exception 'invalid_rhythm';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_recipient_key_hash, 7721)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_email, 7723)
  );

  if exists (
    select 1
    from public.mailer_suppressions s
    where s.email = p_email
      or s.recipient_key_hash = p_recipient_key_hash
  ) then
    return query select 'suppressed'::text, null::uuid, false, null::smallint;
    return;
  end if;

  select s.*
  into v_subscriber
  from public.subscribers s
  where s.email = p_email
  for update;

  if found and v_subscriber.status = 'suppressed' then
    return query select 'suppressed'::text, null::uuid, false, null::smallint;
    return;
  end if;

  if found then
    v_subscriber_id := v_subscriber.id;
  else
    if p_birth_day_of_year is null or p_origin_day is null then
      raise exception 'birthdate_required';
    end if;
    insert into public.subscribers (email, timezone, status, source)
    values (p_email, p_timezone, 'active', p_source)
    returning id into v_subscriber_id;
    v_is_new := true;
  end if;

  select true, p.birth_day_of_year::smallint, p.origin_day::smallint
  into v_has_profile, v_profile_birth, v_profile_origin
  from public.subscriber_profile p
  where p.subscriber_id = v_subscriber_id
  for update;
  v_has_profile := found;

  if not v_has_profile or v_profile_birth is null or v_profile_origin is null then
    if p_birth_day_of_year is null or p_origin_day is null then
      raise exception 'birthdate_required';
    end if;
    insert into public.subscriber_profile (
      subscriber_id,
      birth_day_of_year,
      origin_day,
      updated_at
    ) values (
      v_subscriber_id,
      p_birth_day_of_year,
      p_origin_day,
      v_now
    )
    on conflict (subscriber_id) do update
      set birth_day_of_year = excluded.birth_day_of_year,
          origin_day = excluded.origin_day,
          updated_at = excluded.updated_at;
    v_profile_birth := p_birth_day_of_year;
    v_profile_origin := p_origin_day;
  end if;

  select true
  into v_has_preferences
  from public.subscriber_preferences p
  where p.subscriber_id = v_subscriber_id
  for update;
  v_has_preferences := found;

  if not v_has_preferences then
    insert into public.subscriber_preferences (
      subscriber_id,
      email_enabled,
      sms_enabled,
      email_opt_in,
      sms_opt_in,
      email_opt_in_at,
      email_consent_version,
      email_consent_recorded_at,
      send_hour_local,
      send_minute_local,
      updated_at
    ) values (
      v_subscriber_id,
      true,
      false,
      true,
      false,
      v_now,
      p_consent_version,
      v_now,
      6,
      0,
      v_now
    );
  elsif v_subscriber.status = 'unsubscribed' then
    update public.subscriber_preferences
    set email_enabled = true,
        email_opt_in = true,
        email_opt_in_at = v_now,
        email_consent_version = p_consent_version,
        email_consent_recorded_at = v_now,
        updated_at = v_now
    where subscriber_id = v_subscriber_id;
  end if;

  if not v_is_new and v_subscriber.status = 'unsubscribed' then
    update public.subscribers
    set status = 'active',
        timezone = p_timezone,
        email_unsubscribed_at = null,
        updated_at = v_now
    where id = v_subscriber_id;

    update public.mailer_welcome_deliveries
    set status = 'pending',
        attempt_count = 0,
        last_attempt_at = null,
        next_attempt_at = v_now,
        error = null,
        updated_at = v_now
    where subscriber_id = v_subscriber_id
      and status = 'cancelled'
      and provider_message_id is null
      and sent_at is null;
  end if;

  if v_is_new then
    insert into public.mailer_welcome_deliveries (
      subscriber_id,
      status,
      next_attempt_at,
      created_at,
      updated_at
    ) values (
      v_subscriber_id,
      'pending',
      v_now,
      v_now,
      v_now
    )
    on conflict (subscriber_id) do nothing;
  end if;

  return query select
    'active'::text,
    v_subscriber_id,
    true,
    v_profile_origin;
end;
$$;

create or replace function public.claim_due_mailer_welcomes(
  p_subscriber_id uuid,
  p_limit integer
)
returns table (
  delivery_id uuid,
  subscriber_id uuid,
  email text
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 25));
begin
  return query
  with due as (
    select w.id
    from public.mailer_welcome_deliveries w
    inner join public.subscribers s on s.id = w.subscriber_id
    inner join public.subscriber_preferences p on p.subscriber_id = s.id
    where (p_subscriber_id is null or w.subscriber_id = p_subscriber_id)
      and s.status = 'active'
      and p.email_enabled is true
      and p.email_opt_in is true
      and w.attempt_count < 5
      and (
        (w.status in ('pending', 'failed') and w.next_attempt_at <= v_now)
        or (
          w.status = 'processing'
          and w.last_attempt_at <= v_now - interval '10 minutes'
        )
      )
    order by w.next_attempt_at, w.created_at
    for update of w skip locked
    limit v_limit
  ),
  claimed as (
    update public.mailer_welcome_deliveries w
    set status = 'processing',
        attempt_count = w.attempt_count + 1,
        last_attempt_at = v_now,
        error = null,
        updated_at = v_now
    from due
    where w.id = due.id
    returning w.id, w.subscriber_id
  )
  select c.id, c.subscriber_id, s.email
  from claimed c
  inner join public.subscribers s on s.id = c.subscriber_id;
end;
$$;

create or replace function public.complete_mailer_welcome(
  p_delivery_id uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_provider_message_id is null
    or pg_catalog.char_length(pg_catalog.btrim(p_provider_message_id)) not between 1 and 255 then
    raise exception 'invalid_provider_message_id';
  end if;

  update public.mailer_welcome_deliveries
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = pg_catalog.clock_timestamp(),
      error = null,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_delivery_id
    and status = 'processing';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'welcome_not_processing';
  end if;
end;
$$;

create or replace function public.is_mailer_welcome_sendable(p_delivery_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.mailer_welcome_deliveries w
    inner join public.subscribers s on s.id = w.subscriber_id
    inner join public.subscriber_preferences p on p.subscriber_id = s.id
    where w.id = p_delivery_id
      and w.status = 'processing'
      and s.status = 'active'
      and p.email_enabled is true
      and p.email_opt_in is true
      and p.email_opt_in_at is not null
  );
$$;

create or replace function public.fail_mailer_welcome(
  p_delivery_id uuid,
  p_error text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.mailer_welcome_deliveries
  set status = case when attempt_count >= 5 then 'cancelled' else 'failed' end,
      error = pg_catalog.left(coalesce(p_error, 'Delivery failed'), 500),
      next_attempt_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(mins => greatest(5, least(attempt_count * 5, 60))),
      updated_at = pg_catalog.clock_timestamp()
  where id = p_delivery_id
    and status = 'processing';
end;
$$;

create or replace function public.suppress_mailer_recipient(
  p_email text,
  p_subscriber_id uuid,
  p_recipient_key_hash text,
  p_reason text,
  p_provider_message_id text,
  p_event_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_email text := p_email;
  v_subscriber_id uuid := p_subscriber_id;
  v_suppression_id uuid;
begin
  if p_reason not in ('email.bounced', 'email.complained', 'email.suppressed') then
    return false;
  end if;

  if v_email is null and v_subscriber_id is not null then
    select s.email into v_email
    from public.subscribers s
    where s.id = v_subscriber_id;
  end if;
  if v_email is not null and (
    v_email <> pg_catalog.lower(pg_catalog.btrim(v_email))
    or pg_catalog.char_length(v_email) not between 3 and 320
  ) then
    return false;
  end if;
  if p_recipient_key_hash is not null
    and p_recipient_key_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if v_email is null and p_recipient_key_hash is null then
    return false;
  end if;

  if p_recipient_key_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_recipient_key_hash, 7721)
    );
  end if;
  if v_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_email, 7723)
    );
  end if;

  if v_subscriber_id is null and v_email is not null then
    select s.id into v_subscriber_id
    from public.subscribers s
    where s.email = v_email
    for update;
  else
    perform 1
    from public.subscribers s
    where s.id = v_subscriber_id
    for update;
  end if;

  select s.id into v_suppression_id
  from public.mailer_suppressions s
  where (v_email is not null and s.email = v_email)
    or (
      p_recipient_key_hash is not null
      and s.recipient_key_hash = p_recipient_key_hash
    )
  order by (s.email = v_email) desc nulls last
  limit 1
  for update;

  if found then
    update public.mailer_suppressions
    set email = coalesce(email, v_email),
        recipient_key_hash = coalesce(recipient_key_hash, p_recipient_key_hash),
        subscriber_id = coalesce(subscriber_id, v_subscriber_id),
        reason = p_reason,
        provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        provider_event_at = coalesce(p_event_at, v_now),
        updated_at = v_now
    where id = v_suppression_id;
  else
    insert into public.mailer_suppressions (
      email,
      recipient_key_hash,
      subscriber_id,
      reason,
      provider_message_id,
      provider_event_at,
      created_at,
      updated_at
    ) values (
      v_email,
      p_recipient_key_hash,
      v_subscriber_id,
      p_reason,
      p_provider_message_id,
      coalesce(p_event_at, v_now),
      v_now,
      v_now
    );
  end if;

  if v_subscriber_id is not null then
    update public.subscribers
    set status = 'suppressed',
        updated_at = v_now
    where id = v_subscriber_id;

    update public.subscriber_preferences
    set email_enabled = false,
        updated_at = v_now
    where subscriber_id = v_subscriber_id;
  end if;

  return true;
end;
$$;

create or replace function public.record_mailer_provider_event(
  p_provider_message_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_signup_request_id uuid,
  p_welcome_delivery_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_id uuid;
  v_welcome_id uuid;
  v_subscriber_id uuid;
  v_email text;
  v_recipient_key_hash text;
  v_suppress boolean;
begin
  if p_provider_message_id is null
    or p_event_type not in (
      'email.sent',
      'email.delivered',
      'email.failed',
      'email.bounced',
      'email.complained',
      'email.suppressed'
    ) then
    return false;
  end if;
  v_suppress := p_event_type in ('email.bounced', 'email.complained', 'email.suppressed');

  select r.id, r.subscriber_id, r.email, r.recipient_key_hash
  into v_request_id, v_subscriber_id, v_email, v_recipient_key_hash
  from public.mailer_signup_requests r
  where r.confirmation_provider_message_id = p_provider_message_id
    or (
      r.confirmation_provider_message_id is null
      and r.id = p_signup_request_id
    )
  order by (r.confirmation_provider_message_id = p_provider_message_id) desc nulls last
  limit 1;

  if v_request_id is not null then
    if v_email is null and v_subscriber_id is not null then
      select s.email into v_email
      from public.subscribers s
      where s.id = v_subscriber_id;
    end if;
    if v_recipient_key_hash is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_recipient_key_hash, 7721)
      );
    end if;
    if v_email is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_email, 7723)
      );
    end if;

    select r.subscriber_id, coalesce(r.email, v_email), r.recipient_key_hash
    into v_subscriber_id, v_email, v_recipient_key_hash
    from public.mailer_signup_requests r
    where r.id = v_request_id
    for update;

    update public.mailer_signup_requests
    set status = case
          when v_suppress and status in ('created', 'pending') then 'suppressed'
          when not v_suppress and status = 'created' then 'pending'
          else status
        end,
        provider_status = p_event_type,
        provider_event_at = coalesce(p_event_at, v_now),
        confirmation_provider_message_id = coalesce(
          confirmation_provider_message_id,
          p_provider_message_id
        ),
        confirmation_sent_at = coalesce(confirmation_sent_at, v_now),
        email = case
          when v_suppress and status in ('created', 'pending') then null
          else email
        end,
        timezone = case
          when v_suppress and status in ('created', 'pending') then null
          else timezone
        end,
        birth_day_of_year = case
          when v_suppress and status in ('created', 'pending') then null
          else birth_day_of_year
        end,
        origin_day = case
          when v_suppress and status in ('created', 'pending') then null
          else origin_day
        end,
        payload_cleared_at = case
          when v_suppress and status in ('created', 'pending')
            then coalesce(payload_cleared_at, v_now)
          else payload_cleared_at
        end,
        updated_at = v_now
    where id = v_request_id;

    update public.mailer_signup_attempts
    set outcome = 'sent'
    where request_id = v_request_id
      and outcome = 'created';

    if v_suppress then
      perform public.suppress_mailer_recipient(
        v_email,
        v_subscriber_id,
        v_recipient_key_hash,
        p_event_type,
        p_provider_message_id,
        p_event_at
      );
    end if;
    return true;
  end if;

  select w.id, w.subscriber_id, s.email
  into v_welcome_id, v_subscriber_id, v_email
  from public.mailer_welcome_deliveries w
  inner join public.subscribers s on s.id = w.subscriber_id
  where w.provider_message_id = p_provider_message_id
    or (
      w.provider_message_id is null
      and w.id = p_welcome_delivery_id
    )
  order by (w.provider_message_id = p_provider_message_id) desc nulls last
  limit 1;

  if v_welcome_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_email, 7723)
  );
  if v_suppress then
    perform public.suppress_mailer_recipient(
      v_email,
      v_subscriber_id,
      null,
      p_event_type,
      p_provider_message_id,
      p_event_at
    );
  end if;

  update public.mailer_welcome_deliveries
  set provider_status = p_event_type,
      provider_event_at = coalesce(p_event_at, v_now),
      provider_message_id = coalesce(provider_message_id, p_provider_message_id),
      updated_at = v_now
  where id = v_welcome_id;

  return true;
end;
$$;

create or replace function public.unsubscribe_email_subscriber(p_subscriber_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_email text;
begin
  if p_subscriber_id is null then
    return;
  end if;

  select s.email
  into v_email
  from public.subscribers s
  where s.id = p_subscriber_id;

  if v_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_email, 7723)
    );

    perform 1
    from public.mailer_signup_requests r
    where r.email = v_email
      and r.status in ('created', 'pending')
    order by r.id
    for update;
  end if;

  perform 1
  from public.subscribers s
  where s.id = p_subscriber_id
  for update;

  update public.subscribers
  set status = case
        when status = 'suppressed' then 'suppressed'
        else 'unsubscribed'
      end,
      email_unsubscribed_at = v_now,
      updated_at = v_now
  where id = p_subscriber_id;

  update public.subscriber_preferences
  set email_enabled = false,
      email_opt_in = false,
      updated_at = v_now
  where subscriber_id = p_subscriber_id;

  update public.delivery_log
  set status = 'skipped',
      error = 'Subscriber opted out before delivery',
      updated_at = v_now
  where subscriber_id = p_subscriber_id
    and channel = 'email'
    and status in ('queued', 'processing');

  update public.mailer_welcome_deliveries
  set status = 'cancelled',
      updated_at = v_now
  where subscriber_id = p_subscriber_id
    and status in ('pending', 'processing', 'failed');

  if v_email is not null then
    update public.mailer_signup_requests
    set status = 'invalidated',
        subscriber_id = p_subscriber_id,
        email = null,
        timezone = null,
        birth_day_of_year = null,
        origin_day = null,
        payload_cleared_at = coalesce(payload_cleared_at, v_now),
        updated_at = v_now
    where email = v_email
      and status in ('created', 'pending')
      and created_at <= v_now;
  end if;
end;
$$;

revoke all on function public.cleanup_mailer_signup_requests() from public, anon, authenticated;
revoke all on function public.create_mailer_signup_request(text, text, text, smallint, smallint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_mailer_confirmation_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.mark_mailer_confirmation_failed(uuid) from public, anon, authenticated;
revoke all on function public.confirm_mailer_signup(text) from public, anon, authenticated;
revoke all on function public.activate_authenticated_email_subscriber(text, text, text, smallint, smallint, text, text) from public, anon, authenticated;
revoke all on function public.claim_due_mailer_welcomes(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_mailer_welcome(uuid, text) from public, anon, authenticated;
revoke all on function public.is_mailer_welcome_sendable(uuid) from public, anon, authenticated;
revoke all on function public.fail_mailer_welcome(uuid, text) from public, anon, authenticated;
revoke all on function public.suppress_mailer_recipient(text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_mailer_provider_event(text, text, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.unsubscribe_email_subscriber(uuid) from public, anon, authenticated;

grant execute on function public.cleanup_mailer_signup_requests() to service_role;
grant execute on function public.create_mailer_signup_request(text, text, text, smallint, smallint, text, text, text, text) to service_role;
grant execute on function public.mark_mailer_confirmation_sent(uuid, text) to service_role;
grant execute on function public.mark_mailer_confirmation_failed(uuid) to service_role;
grant execute on function public.confirm_mailer_signup(text) to service_role;
grant execute on function public.activate_authenticated_email_subscriber(text, text, text, smallint, smallint, text, text) to service_role;
grant execute on function public.claim_due_mailer_welcomes(uuid, integer) to service_role;
grant execute on function public.complete_mailer_welcome(uuid, text) to service_role;
grant execute on function public.is_mailer_welcome_sendable(uuid) to service_role;
grant execute on function public.fail_mailer_welcome(uuid, text) to service_role;
grant execute on function public.suppress_mailer_recipient(text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.record_mailer_provider_event(text, text, timestamptz, uuid, uuid) to service_role;
grant execute on function public.unsubscribe_email_subscriber(uuid) to service_role;

commit;
