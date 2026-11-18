-- Emergency DDL reversal of mailer wrapper routing only. No row deletions.
-- First coordinate AGE_MAILER_ENFORCEMENT_READY=false and legacy route deployment.
-- Normal rollback only needs both env and DB flag false; this script is optional.
-- Preserve dormant readiness table/RPC for compatibility and every eligibility row.
begin;
update public.mailer_age_enforcement set enabled=false where singleton;
create or replace function public.create_eligible_mailer_signup_request(
  p_token_hash text,p_email text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,
  p_consent_version text,p_source text,p_recipient_key_hash text,p_ip_key_hash text,
  p_country text,p_policy_version text,p_minimum_age integer,p_age_band text)
returns table(result_state text,request_id uuid,retry_after_seconds integer)
language plpgsql security invoker set search_path = '' as $$
declare v_result record;
begin
  if p_country is null or p_country !~ '^[A-Z]{2}$' or p_policy_version is null or length(p_policy_version) not between 1 and 80
    or p_minimum_age is null or p_minimum_age not between 13 and 18 or p_age_band is null or p_age_band not in ('13-15','16-17','adult') then
    raise exception 'signup_eligibility_required';
  end if;
  select * into v_result from public.create_mailer_signup_request(p_token_hash,p_email,p_timezone,p_birth_day_of_year,p_origin_day,p_consent_version,p_source,p_recipient_key_hash,p_ip_key_hash);
  if v_result.result_state = 'created' then
    update public.mailer_signup_requests set eligibility_country=p_country,eligibility_policy_version=p_policy_version,
      eligibility_minimum_age=p_minimum_age,eligibility_age_band=p_age_band,eligibility_checked_at=clock_timestamp()
    where id=v_result.request_id;
  end if;
  return query select v_result.result_state,v_result.request_id,v_result.retry_after_seconds;
end;
$$;
revoke all on function public.create_eligible_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.create_eligible_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text,text,text,integer,text) to service_role;


create or replace function public.confirm_eligible_mailer_signup(p_token_hash text, p_policies jsonb)
returns table(result_state text,subscriber_id uuid,timezone text,send_hour_local smallint,send_minute_local smallint)
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.mailer_signup_requests r where r.token_hash=p_token_hash and r.eligibility_checked_at is not null
    and p_policies->r.eligibility_country->>'version' = r.eligibility_policy_version
    and (p_policies->r.eligibility_country->>'minimumAge')::integer = r.eligibility_minimum_age) then
    return query select 'eligibility_required'::text,null::uuid,null::text,null::smallint,null::smallint;
    return;
  end if;
  return query select * from public.confirm_mailer_signup(p_token_hash);
end;
$$;
revoke all on function public.confirm_eligible_mailer_signup(text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_eligible_mailer_signup(text,jsonb) to service_role;

drop function public.activate_eligible_authenticated_email_subscriber(uuid,text,text,text,smallint,smallint,text,text);
drop function public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text);
alter function sineday_mailer_internal.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text) set schema public;
revoke all on function public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text) to service_role;
drop function public.confirm_mailer_signup(text);
alter function sineday_mailer_internal.confirm_mailer_signup(text) set schema public;
revoke all on function public.confirm_mailer_signup(text) from public,anon,authenticated;
grant execute on function public.confirm_mailer_signup(text) to service_role;
drop function public.activate_authenticated_email_subscriber(text,text,text,smallint,smallint,text,text);
alter function sineday_mailer_internal.activate_authenticated_email_subscriber(text,text,text,smallint,smallint,text,text) set schema public;
revoke all on function public.activate_authenticated_email_subscriber(text,text,text,smallint,smallint,text,text) from public,anon,authenticated;
grant execute on function public.activate_authenticated_email_subscriber(text,text,text,smallint,smallint,text,text) to service_role;
drop schema sineday_mailer_internal;
commit;
