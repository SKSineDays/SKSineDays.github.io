-- Independent mailer consent decisions, separate from product account minimum.
-- Additive staged migration. No users, subscriptions, delivery jobs or flags changed.
-- Supabase CLI unavailable in this workspace; timestamp follows staged repository convention.
begin;
create table public.mailer_age_policy_config (
 country text primary key check(country ~ '^[A-Z]{2}$'),
 minimum_age integer not null check(minimum_age between 13 and 18),
 policy_version text not null check(length(policy_version) between 1 and 80)
);
alter table public.mailer_age_policy_config enable row level security;
revoke all on public.mailer_age_policy_config from public,anon,authenticated;
grant select on public.mailer_age_policy_config to service_role;
-- US is a product/COPPA screening minimum, not a claim that all marketing consent law is met.
-- EU thresholds apply to independent consent; this does not implement parental authorization.
insert into public.mailer_age_policy_config(country,minimum_age,policy_version) values
 ('US',13,'us-independent-13-v1'),
 ('BE',13,'eu-mailer-consent-13-v1'),
 ('EE',13,'eu-mailer-consent-13-v1'),
 ('FI',13,'eu-mailer-consent-13-v1'),
 ('LV',13,'eu-mailer-consent-13-v1'),
 ('MT',13,'eu-mailer-consent-13-v1'),
 ('PT',13,'eu-mailer-consent-13-v1'),
 ('SE',13,'eu-mailer-consent-13-v1'),
 ('AT',14,'eu-mailer-consent-14-v1'),
 ('BG',14,'eu-mailer-consent-14-v1'),
 ('CY',14,'eu-mailer-consent-14-v1'),
 ('ES',14,'eu-mailer-consent-14-v1'),
 ('IT',14,'eu-mailer-consent-14-v1'),
 ('LT',14,'eu-mailer-consent-14-v1'),
 ('CZ',15,'eu-mailer-consent-15-v1'),
 ('DK',15,'eu-mailer-consent-15-v1'),
 ('FR',15,'eu-mailer-consent-15-v1'),
 ('GR',15,'eu-mailer-consent-15-v1'),
 ('SI',15,'eu-mailer-consent-15-v1'),
 ('DE',16,'eu-mailer-consent-16-v1'),
 ('HR',16,'eu-mailer-consent-16-v1'),
 ('HU',16,'eu-mailer-consent-16-v1'),
 ('IE',16,'eu-mailer-consent-16-v1'),
 ('LU',16,'eu-mailer-consent-16-v1'),
 ('NL',16,'eu-mailer-consent-16-v1'),
 ('PL',16,'eu-mailer-consent-16-v1'),
 ('RO',16,'eu-mailer-consent-16-v1'),
 ('SK',16,'eu-mailer-consent-16-v1');

create table public.account_mailer_eligibility (
 user_id uuid primary key references auth.users(id) on delete cascade,
 country text not null check(country ~ '^[A-Z]{2}$'),
 policy_version text not null check(length(policy_version) between 1 and 80),
 minimum_age integer not null check(minimum_age between 13 and 18),
 age_band text not null check(age_band in ('under13','13-15','16-17','adult')),
 status text not null check(status in ('eligible','review_required')),
 method text not null default 'self_declared' check(method='self_declared'),
 checked_at timestamptz not null default clock_timestamp(),
 check(status<>'eligible' or (age_band<>'under13' and (minimum_age<16 or age_band<>'13-15') and (minimum_age<18 or age_band<>'16-17')))
);
alter table public.account_mailer_eligibility enable row level security;
revoke all on public.account_mailer_eligibility from public,anon,authenticated;
-- Deliberately no direct UPDATE/DELETE grant; normal declaration cannot erase a refusal.
grant select,insert on public.account_mailer_eligibility to service_role;

-- Service caller has verified p_user_id with Auth and evaluated the real declaration
-- against the mailer policy. Coarse bands alone NEVER prove age14 or15. Full DOB is not saved.
create function public.record_mailer_eligibility_decision(p_user_id uuid,p_country text,p_policy_version text,p_minimum_age integer,p_age_band text,p_eligible boolean)
returns setof public.account_mailer_eligibility language plpgsql security invoker set search_path='' as $$
begin
 if p_eligible is null or p_user_id is null then raise exception 'mailer_eligibility_decision_required'; end if;
 if not exists(select 1 from public.mailer_age_policy_config p where p.country=p_country and p.policy_version=p_policy_version and p.minimum_age=p_minimum_age) then
   raise exception 'mailer_policy_unavailable';
 end if;
 if p_eligible and exists(select 1 from public.account_eligibility a where a.user_id=p_user_id and a.status='review_required') then raise exception 'account_eligibility_review_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,91815));
 insert into public.account_mailer_eligibility(user_id,country,policy_version,minimum_age,age_band,status)
 values(p_user_id,p_country,p_policy_version,p_minimum_age,p_age_band,case when p_eligible then 'eligible' else 'review_required' end)
 on conflict(user_id) do nothing;
 return query select * from public.account_mailer_eligibility where user_id=p_user_id;
end;
$$;
revoke all on function public.record_mailer_eligibility_decision(uuid,text,text,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.record_mailer_eligibility_decision(uuid,text,text,integer,text,boolean) to service_role;

create or replace function public.create_eligible_mailer_signup_request(
  p_token_hash text,p_email text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,
  p_consent_version text,p_source text,p_recipient_key_hash text,p_ip_key_hash text,
  p_country text,p_policy_version text,p_minimum_age integer,p_age_band text)
returns table(result_state text,request_id uuid,retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare v_result record;
begin
  if p_country is null or p_country !~ '^[A-Z]{2}$' or p_policy_version is null or length(p_policy_version) not between 1 and 80
    or p_minimum_age is null or p_minimum_age not between 13 and 18 or p_age_band is null or p_age_band not in ('13-15','16-17','adult') then
    raise exception 'signup_eligibility_required';
  end if;
  if (p_minimum_age>=16 and p_age_band='13-15') or (p_minimum_age=18 and p_age_band='16-17')
    or not exists(select 1 from public.mailer_age_policy_config p where p.country=p_country and p.policy_version=p_policy_version and p.minimum_age=p_minimum_age) then raise exception 'signup_eligibility_required'; end if;
  -- Known refusals apply to this same requested address even on anonymous signup.
  if exists(select 1 from auth.users u
    left join public.account_eligibility a on a.user_id=u.id
    left join public.account_mailer_eligibility m on m.user_id=u.id
    where lower(btrim(u.email))=lower(btrim(p_email))
      and (a.status='review_required' or m.status='review_required')) then raise exception 'mailer_age_eligibility_required'; end if;
  select * into v_result from sineday_mailer_internal.create_mailer_signup_request(p_token_hash,p_email,p_timezone,p_birth_day_of_year,p_origin_day,p_consent_version,p_source,p_recipient_key_hash,p_ip_key_hash);
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
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.mailer_signup_requests r where r.token_hash=p_token_hash and r.eligibility_checked_at is not null
    and r.eligibility_age_band in ('13-15','16-17','adult')
    and (r.eligibility_minimum_age<16 or r.eligibility_age_band<>'13-15')
    and (r.eligibility_minimum_age<18 or r.eligibility_age_band<>'16-17')
    and not exists(select 1 from auth.users u
    left join public.account_eligibility a on a.user_id=u.id
    left join public.account_mailer_eligibility m on m.user_id=u.id
    where lower(btrim(u.email))=lower(btrim(r.email))
      and (a.status='review_required' or m.status='review_required'))
    and exists(select 1 from public.mailer_age_policy_config p where p.country=r.eligibility_country and p.policy_version=r.eligibility_policy_version and p.minimum_age=r.eligibility_minimum_age)
    and p_policies->r.eligibility_country->>'version' = r.eligibility_policy_version
    and (p_policies->r.eligibility_country->>'minimumAge')::integer = r.eligibility_minimum_age) then
    return query select 'eligibility_required'::text,null::uuid,null::text,null::smallint,null::smallint;
    return;
  end if;
  return query select * from sineday_mailer_internal.confirm_mailer_signup(p_token_hash);
end;
$$;
revoke all on function public.confirm_eligible_mailer_signup(text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_eligible_mailer_signup(text,jsonb) to service_role;

-- Service endpoint binds p_user_id AND p_email to the same verified Auth user.
create or replace function public.activate_eligible_authenticated_email_subscriber(
 p_user_id uuid,p_email text,p_recipient_key_hash text,p_timezone text,
 p_birth_day_of_year smallint,p_origin_day smallint,p_consent_version text,p_source text)
returns table(result_state text,subscriber_id uuid,profile_configured boolean,origin_day smallint)
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.account_eligibility a where a.user_id=p_user_id and a.status='review_required')
   or not exists(select 1 from public.account_mailer_eligibility e
   join public.mailer_age_policy_config p on p.country=e.country and p.policy_version=e.policy_version and p.minimum_age=e.minimum_age
   join auth.users u on u.id=e.user_id
   where e.user_id=p_user_id and lower(btrim(u.email))=p_email
     and e.status='eligible' and e.age_band in ('13-15','16-17','adult')) then
   raise exception 'mailer_age_eligibility_required';
 end if;
 return query select * from sineday_mailer_internal.activate_authenticated_email_subscriber(
  p_email,p_recipient_key_hash,p_timezone,p_birth_day_of_year,p_origin_day,p_consent_version,p_source);
end;
$$;
revoke all on function public.activate_eligible_authenticated_email_subscriber(uuid,text,text,text,smallint,smallint,text,text) from public,anon,authenticated;
grant execute on function public.activate_eligible_authenticated_email_subscriber(uuid,text,text,text,smallint,smallint,text,text) to service_role;
commit;
