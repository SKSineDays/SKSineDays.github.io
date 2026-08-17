-- Daily email scheduler: 6:00 AM local delivery, atomic claims, atomic unsubscribe.
-- Vercel invokes GET /api/cron/daily-email every minute in UTC. Due windows are
-- computed from each subscriber's IANA timezone. delivery_unique remains the
-- durable idempotency boundary for (subscriber_id, channel, send_date).

alter table public.subscriber_preferences
  alter column send_hour_local set default 6;

update public.subscriber_preferences
set send_hour_local = 6,
    updated_at = now()
where send_hour_local = 7
  and send_minute_local = 0;

-- Lossless legacy backfill: application code defines sineday_index = origin_day - 1.
-- Do not derive origin_day from birth_day_of_year; the birth year is required.
update public.subscriber_profile
set origin_day = (sineday_index + 1)::smallint,
    updated_at = now()
where origin_day is null
  and sineday_index between 0 and 17;

alter table public.delivery_log
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists local_timezone text,
  add column if not exists sineday_day smallint,
  add column if not exists template_alias text,
  add column if not exists provider_status text,
  add column if not exists provider_event_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'delivery_log_attempt_count_chk'
  ) then
    alter table public.delivery_log
      add constraint delivery_log_attempt_count_chk
      check (attempt_count >= 0);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'delivery_log_sineday_day_chk'
  ) then
    alter table public.delivery_log
      add constraint delivery_log_sineday_day_chk
      check (sineday_day is null or sineday_day between 1 and 18);
  end if;
end
$$;

create index if not exists delivery_log_provider_message_id_idx
  on public.delivery_log (provider_message_id)
  where provider_message_id is not null;

create or replace function public.claim_due_daily_emails(
  p_now timestamptz,
  p_limit integer
)
returns table (
  delivery_id uuid,
  subscriber_id uuid,
  email text,
  timezone text,
  local_date date,
  origin_day smallint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_limit integer;
begin
  v_now := pg_catalog.coalesce(p_now, pg_catalog.clock_timestamp());
  v_limit := pg_catalog.greatest(1, pg_catalog.least(pg_catalog.coalesce(p_limit, 50), 200));

  return query
  with eligible as (
    select
      s.id as subscriber_id,
      s.email,
      s.timezone,
      pr.origin_day,
      (v_now at time zone s.timezone) as local_ts,
      ((v_now at time zone s.timezone)::date) as local_date,
      (
        ((v_now at time zone s.timezone)::date)
        + pg_catalog.make_time(p.send_hour_local, p.send_minute_local, 0.0)
      ) as send_at
    from public.subscribers s
    inner join public.subscriber_preferences p
      on p.subscriber_id = s.id
    inner join public.subscriber_profile pr
      on pr.subscriber_id = s.id
    inner join pg_catalog.pg_timezone_names tz
      on tz.name = s.timezone
    where s.status = 'active'
      and s.email is not null
      and pg_catalog.length(pg_catalog.btrim(s.email)) > 0
      and p.email_enabled is true
      and p.email_opt_in is true
      and p.email_opt_in_at is not null
      and pr.origin_day between 1 and 18
      and p.send_hour_local between 0 and 23
      and p.send_minute_local between 0 and 59
  ),
  due as (
    select e.*
    from eligible e
    where e.local_ts >= e.send_at
      and e.local_ts < (e.send_at + interval '6 hours')
      and not exists (
        select 1
        from public.delivery_log d
        where d.subscriber_id = e.subscriber_id
          and d.channel = 'email'
          and d.send_date = e.local_date
          and (
            d.status in ('sent', 'skipped')
            or (
              d.status = 'processing'
              and pg_catalog.coalesce(d.last_attempt_at, d.created_at)
                > (v_now - interval '10 minutes')
            )
          )
      )
    order by e.send_at asc, e.subscriber_id asc
    limit v_limit
  ),
  claimed as (
    insert into public.delivery_log (
      subscriber_id,
      channel,
      send_date,
      status,
      attempt_count,
      last_attempt_at,
      local_timezone,
      updated_at
    )
    select
      due.subscriber_id,
      'email',
      due.local_date,
      'processing',
      1,
      v_now,
      due.timezone,
      v_now
    from due
    on conflict (subscriber_id, channel, send_date)
    do update
      set status = 'processing',
          attempt_count = public.delivery_log.attempt_count + 1,
          last_attempt_at = v_now,
          local_timezone = excluded.local_timezone,
          error = null,
          updated_at = v_now
      where public.delivery_log.status in ('queued', 'failed')
         or (
           public.delivery_log.status = 'processing'
           and pg_catalog.coalesce(
             public.delivery_log.last_attempt_at,
             public.delivery_log.created_at
           ) <= (v_now - interval '10 minutes')
         )
    returning
      public.delivery_log.id,
      public.delivery_log.subscriber_id,
      public.delivery_log.send_date,
      public.delivery_log.local_timezone
  )
  select
    wrapped.delivery_id,
    wrapped.subscriber_id,
    wrapped.subscriber_email,
    wrapped.subscriber_timezone,
    wrapped.local_date,
    wrapped.claimed_origin_day
  from (
    select
      claimed.id as delivery_id,
      claimed.subscriber_id,
      s.email as subscriber_email,
      s.timezone as subscriber_timezone,
      claimed.send_date as local_date,
      pr.origin_day as claimed_origin_day
    from claimed
    inner join public.subscribers s
      on s.id = claimed.subscriber_id
    inner join public.subscriber_profile pr
      on pr.subscriber_id = claimed.subscriber_id
  ) wrapped;
end;
$$;

comment on function public.claim_due_daily_emails(timestamptz, integer) is
  'Atomically claims due daily emails for the local send window. Inject p_now for timezone tests.';

create or replace function public.unsubscribe_email_subscriber(p_subscriber_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_subscriber_id is null then
    return;
  end if;

  update public.subscribers
  set status = 'unsubscribed',
      updated_at = pg_catalog.now()
  where id = p_subscriber_id;

  update public.subscriber_preferences
  set email_enabled = false,
      email_opt_in = false,
      updated_at = pg_catalog.now()
  where subscriber_id = p_subscriber_id;

  update public.delivery_log
  set status = 'skipped',
      error = 'Subscriber opted out before delivery',
      updated_at = pg_catalog.now()
  where subscriber_id = p_subscriber_id
    and channel = 'email'
    and status in ('queued', 'processing');
end;
$$;

comment on function public.unsubscribe_email_subscriber(uuid) is
  'Atomically disables email for a subscriber and skips in-flight daily deliveries.';

revoke all on function public.claim_due_daily_emails(timestamptz, integer) from public;
revoke all on function public.claim_due_daily_emails(timestamptz, integer) from anon, authenticated;
grant execute on function public.claim_due_daily_emails(timestamptz, integer) to service_role;

revoke all on function public.unsubscribe_email_subscriber(uuid) from public;
revoke all on function public.unsubscribe_email_subscriber(uuid) from anon, authenticated;
grant execute on function public.unsubscribe_email_subscriber(uuid) to service_role;
