-- STAGED ONLY: coordinated Auth hook + application rollout required.
-- Existing accounts/subscribers are neither scanned nor modified. No DOB is stored.
begin;

create table public.account_signup_admissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('email','google','apple')),
  subject text not null check (length(subject) between 1 and 320),
  flow_hash text not null unique check (flow_hash ~ '^[0-9a-f]{64}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  policy_version text not null check (length(policy_version) between 1 and 80),
  minimum_age integer not null check (minimum_age between 13 and 18),
  age_band text not null check (age_band in ('13-15','16-17','adult')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '5 minutes',
  consumed_at timestamptz,
  bound_user_id uuid unique references auth.users(id) on delete cascade
);
create index account_signup_admissions_subject_idx on public.account_signup_admissions(provider,subject,expires_at);
alter table public.account_signup_admissions enable row level security;
revoke all on public.account_signup_admissions from public, anon, authenticated;
grant select, insert, update, delete on public.account_signup_admissions to service_role;

create table public.account_eligibility (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country text not null check (country ~ '^[A-Z]{2}$'),
  policy_version text not null check (length(policy_version) between 1 and 80),
  minimum_age integer not null check (minimum_age between 13 and 18),
  age_band text not null check (age_band in ('under13','13-15','16-17','adult')),
  status text not null default 'eligible' check (status in ('eligible','review_required')),
  constraint eligible_age_band check (status <> 'eligible' or age_band <> 'under13'),
  method text not null default 'self_declared' check (method = 'self_declared'),
  checked_at timestamptz not null default clock_timestamp()
);
alter table public.account_eligibility enable row level security;
revoke all on public.account_eligibility from public, anon, authenticated;
grant select, insert, update, delete on public.account_eligibility to service_role;

-- Atomic first declaration: a rejected owner cannot retry with a different DOB.
-- Support corrections require a separate audited privileged workflow, not this RPC.
create function public.record_account_eligibility_decision(p_user_id uuid,p_country text,p_policy_version text,p_minimum_age integer,p_age_band text,p_eligible boolean)
returns setof public.account_eligibility language plpgsql security invoker set search_path = '' as $$
begin
  if p_eligible is null then raise exception 'eligibility_decision_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,91814));
  insert into public.account_eligibility(user_id,country,policy_version,minimum_age,age_band,status)
  values(p_user_id,p_country,p_policy_version,p_minimum_age,p_age_band,case when p_eligible then 'eligible' else 'review_required' end)
  on conflict (user_id) do nothing;
  return query select * from public.account_eligibility where user_id=p_user_id;
end;
$$;
revoke all on function public.record_account_eligibility_decision(uuid,text,text,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.record_account_eligibility_decision(uuid,text,text,integer,text,boolean) to service_role;

create function public.cleanup_account_admissions()
returns void language sql security invoker set search_path = '' as $$
  delete from public.account_signup_admissions where expires_at < clock_timestamp() - interval '1 day';
$$;
revoke all on function public.cleanup_account_admissions() from public, anon, authenticated;
grant execute on function public.cleanup_account_admissions() to service_role;

create function public.issue_account_admission(p_provider text,p_subject text,p_flow_hash text,p_country text,p_policy_version text,p_minimum_age integer,p_age_band text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_subject, 91813));
  if (select count(*) from public.account_signup_admissions where provider=p_provider and subject=p_subject and created_at > clock_timestamp() - interval '1 hour') >= 5 then
    raise exception 'signup_rate_limited';
  end if;
  -- Expired admission subjects/proofs are transient; final eligibility lives separately.
  delete from public.account_signup_admissions where expires_at < clock_timestamp() - interval '1 day';
  insert into public.account_signup_admissions(provider,subject,flow_hash,country,policy_version,minimum_age,age_band)
  values(p_provider,p_subject,p_flow_hash,p_country,p_policy_version,p_minimum_age,p_age_band) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.issue_account_admission(text,text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.issue_account_admission(text,text,text,text,text,integer,text) to service_role;

create function public.before_user_created_eligibility(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := event->'user'->'app_metadata'->>'provider';
  v_subject text;
  v_flow_hash text;
  v_id uuid;
begin
  if v_provider = 'email' then
    v_subject := lower(btrim(event->'user'->>'email'));
    v_flow_hash := encode(sha256(convert_to(event->'user'->'user_metadata'->>'signup_admission_token','UTF8')),'hex');
  elsif v_provider in ('google','apple') then
    -- Validated provider metadata only on new social signup. Must test hosted payload.
    v_subject := event->'user'->'user_metadata'->>'sub';
  else
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Please complete signup eligibility on SineDay.'));
  end if;
  select a.id into v_id from public.account_signup_admissions a
    where a.provider = v_provider and a.subject = v_subject
      and (v_provider <> 'email' or a.flow_hash = v_flow_hash)
      and a.consumed_at is null and a.expires_at > clock_timestamp()
    order by a.created_at desc limit 1 for update skip locked;
  if v_id is null then
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Please complete signup eligibility on SineDay.'));
  end if;
  update public.account_signup_admissions set consumed_at = clock_timestamp() where id = v_id;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.before_user_created_eligibility(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.before_user_created_eligibility(jsonb) to supabase_auth_admin;

create function public.bind_new_account_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := new.raw_app_meta_data->>'provider';
  v_subject text;
  v_flow_hash text;
  v_admission public.account_signup_admissions%rowtype;
begin
  if v_provider = 'email' then
    v_subject := lower(btrim(new.email));
    v_flow_hash := encode(sha256(convert_to(new.raw_user_meta_data->>'signup_admission_token','UTF8')),'hex');
  elsif v_provider in ('google','apple') then
    v_subject := new.raw_user_meta_data->>'sub';
  else
    raise exception 'signup_eligibility_required';
  end if;
  select a.* into v_admission from public.account_signup_admissions a
    where a.provider = v_provider and a.subject = v_subject
      and (v_provider <> 'email' or a.flow_hash = v_flow_hash)
      and a.consumed_at is not null and a.bound_user_id is null
      and a.expires_at > clock_timestamp()
    order by a.consumed_at desc limit 1 for update skip locked;
  if v_admission.id is null then raise exception 'signup_eligibility_required'; end if;
  update public.account_signup_admissions set bound_user_id = new.id where id = v_admission.id;
  insert into public.account_eligibility(user_id,country,policy_version,minimum_age,age_band)
    values(new.id,v_admission.country,v_admission.policy_version,v_admission.minimum_age,v_admission.age_band);
  return new;
end;
$$;
revoke all on function public.bind_new_account_eligibility() from public, anon, authenticated, service_role;
create trigger bind_new_account_eligibility after insert on auth.users
  for each row execute function public.bind_new_account_eligibility();

-- Public mailer proof belongs to the pending token, never just a caller's checkbox.
alter table public.mailer_signup_requests
  add column eligibility_country text,
  add column eligibility_policy_version text,
  add column eligibility_minimum_age integer,
  add column eligibility_age_band text,
  add column eligibility_checked_at timestamptz;

create function public.create_eligible_mailer_signup_request(
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

create function public.confirm_eligible_mailer_signup(p_token_hash text, p_policies jsonb)
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
-- EXISTING-OWNER ACCESS: staged, disabled until all provider and recovery tests pass.
-- Keep DB policy configuration aligned with AGE_ELIGIBILITY_POLICIES_JSON.
create table public.account_age_policy_config (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  policy_version text not null,
  minimum_age integer not null check (minimum_age between 13 and 18)
);
insert into public.account_age_policy_config values ('US','us-independent-13-v1',13);
create table public.account_age_enforcement (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.account_age_enforcement values (true,false);
alter table public.account_age_policy_config enable row level security;
alter table public.account_age_enforcement enable row level security;
revoke all on public.account_age_policy_config,public.account_age_enforcement from public,anon,authenticated;
grant select,insert,update,delete on public.account_age_policy_config,public.account_age_enforcement to service_role;

-- Narrow own-account predicate. No user_id argument and no user-editable JWT claims.
create function public.current_account_age_eligible()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    not coalesce((select enabled from public.account_age_enforcement where singleton),true)
    or exists (
      select 1 from public.account_eligibility e
      join public.account_age_policy_config p on p.country=e.country
        and p.policy_version=e.policy_version and p.minimum_age=e.minimum_age
      where e.user_id=auth.uid() and e.status='eligible'
        and e.age_band in ('13-15','16-17','adult')
    )
  );
$$;
revoke all on function public.current_account_age_eligible() from public,anon;
grant execute on function public.current_account_age_eligible() to authenticated;

-- Restrictive AND policy covers every currently RLS-enabled public base table,
-- including live-only planner tables and duplicate permissive owner policies.
-- Deployment audit must reject any new exposed table missing this boundary.
do $$
declare r record;
begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
 loop
   execute format('create policy account_age_access on %I.%I as restrictive for all to authenticated using ((select public.current_account_age_eligible())) with check ((select public.current_account_age_eligible()))',r.nspname,r.relname);
 end loop;
 -- No changes to bucket data or existing objects. Public signed URLs already issued
 -- can remain valid until their expiry; test/review that residual access separately.
 if to_regclass('storage.objects') is not null then
   execute 'create policy account_age_access on storage.objects as restrictive for all to authenticated using ((select public.current_account_age_eligible())) with check ((select public.current_account_age_eligible()))';
 end if;
end $$;

commit;
