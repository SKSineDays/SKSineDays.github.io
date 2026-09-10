-- Correct claim_due_daily_emails: COALESCE, GREATEST, and LEAST are special
-- SQL expressions and cannot be schema-qualified. The applied
-- 20260817071320_daily_email_scheduler.sql migration is left unchanged.
-- Calling the applied function fails with:
--   function pg_catalog.coalesce(timestamp with time zone, timestamp with time zone) does not exist
-- After that correction, ON CONFLICT (subscriber_id, ...) still fails because
-- RETURNS TABLE output names are PL/pgSQL variables. use_column keeps the
-- unique-key inference pointed at delivery_log columns.

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
#variable_conflict use_column
declare
  v_now timestamptz;
  v_limit integer;
begin
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

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
              and coalesce(d.last_attempt_at, d.created_at)
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
           and coalesce(
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

revoke all on function public.claim_due_daily_emails(timestamptz, integer) from public;
revoke all on function public.claim_due_daily_emails(timestamptz, integer) from anon, authenticated;
grant execute on function public.claim_due_daily_emails(timestamptz, integer) to service_role;
