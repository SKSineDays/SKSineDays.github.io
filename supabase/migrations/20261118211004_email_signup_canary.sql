-- EMAIL-ONLY operator canary. No configured target/identity is stored in source.
-- Empty scope table means no change to normal signup. All global flags remain untouched.
begin;
create table public.account_signup_canaries (
 id uuid primary key default gen_random_uuid(),
 operator_id uuid not null unique references auth.users(id),
 target_email text not null unique check(target_email=lower(btrim(target_email)) and length(target_email) between 3 and 254 and target_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 issued_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
alter table public.account_signup_canaries enable row level security;
revoke all on public.account_signup_canaries from public,anon,authenticated;
grant select,insert,update on public.account_signup_canaries to service_role;
alter table public.account_signup_admissions add column canary_scope_id uuid references public.account_signup_canaries(id);

create function public.get_signup_canary(p_operator_id uuid)
returns table(canary_id uuid,target_email text,expires_at timestamptz)
language sql security definer set search_path='' as $$
 select c.id,c.target_email,c.expires_at from public.account_signup_canaries c
 where c.operator_id=p_operator_id and c.expires_at>clock_timestamp() and c.issued_at is null;
$$;
revoke all on function public.get_signup_canary(uuid) from public,anon,authenticated;
grant execute on function public.get_signup_canary(uuid) to service_role;

-- One grant per scope, even if subsequent OTP delivery fails. No automatic retry/reset.
-- Operator comes from verified server authentication, never an unverified request field.
create function public.issue_signup_canary_admission(p_operator_id uuid,p_canary_id uuid,p_flow_hash text,
 p_country text,p_policy_version text,p_minimum_age integer,p_age_band text)
returns text language plpgsql security definer set search_path='' as $$
declare c public.account_signup_canaries%rowtype; v_admission uuid;
begin
 select * into c from public.account_signup_canaries
 where id=p_canary_id and operator_id=p_operator_id for update;
 if c.id is null or c.expires_at<=clock_timestamp() or c.issued_at is not null then raise exception 'canary_unavailable'; end if;
 if exists(select 1 from auth.users u where lower(btrim(u.email))=c.target_email) then raise exception 'canary_target_already_registered'; end if;
 if p_country<>'US' or p_minimum_age<>13 or p_age_band not in ('13-15','16-17','adult')
   or not exists(select 1 from public.account_age_policy_config p where p.country=p_country and p.policy_version=p_policy_version and p.minimum_age=p_minimum_age)
 then raise exception 'canary_eligibility_required'; end if;
 v_admission:=public.issue_account_admission('email',c.target_email,p_flow_hash,p_country,p_policy_version,p_minimum_age,p_age_band);
 update public.account_signup_admissions set canary_scope_id=c.id where id=v_admission;
 update public.account_signup_canaries set issued_at=clock_timestamp() where id=c.id;
 return c.target_email;
end;
$$;
revoke all on function public.issue_signup_canary_admission(uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.issue_signup_canary_admission(uuid,uuid,text,text,text,integer,text) to service_role;

create or replace function public.before_user_created_eligibility(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := event->'user'->'app_metadata'->>'provider';
  v_subject text;
  v_canary uuid;
  v_scoped_flow boolean:=false;
  v_flow_hash text;
  v_id uuid;
begin

  if v_provider is distinct from 'email' and not public.account_signup_enforcement_is_enabled() then return '{}'::jsonb; end if;
  if v_provider = 'email' then
    v_subject := lower(btrim(event->'user'->>'email'));
    v_flow_hash := encode(sha256(convert_to(event->'user'->'user_metadata'->>'signup_admission_token','UTF8')),'hex');
  elsif v_provider in ('google','apple') then
    -- Validated provider metadata only on new social signup. Must test hosted payload.
    v_subject := event->'user'->'user_metadata'->>'sub';
  else
    return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Please complete signup eligibility on SineDay.'));
  end if;
  if v_provider='email' then
    select c.id into v_canary from public.account_signup_canaries c
      where c.target_email=v_subject and c.expires_at>clock_timestamp();
    select exists(select 1 from public.account_signup_admissions a
      where a.provider='email' and a.subject=v_subject and a.flow_hash=v_flow_hash
        and a.canary_scope_id is not null) into v_scoped_flow;
  end if;
  if not public.account_signup_enforcement_is_enabled() and v_canary is null and not v_scoped_flow then return '{}'::jsonb; end if;
  select a.id into v_id from public.account_signup_admissions a
    where a.provider = v_provider and a.subject = v_subject
      and (v_provider <> 'email' or a.flow_hash = v_flow_hash)
      and (v_canary is null or a.canary_scope_id=v_canary)
      and (a.canary_scope_id is null or exists(select 1 from public.account_signup_canaries c
        where c.id=a.canary_scope_id and c.target_email=v_subject and c.expires_at>clock_timestamp()))
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


create or replace function public.bind_new_account_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := new.raw_app_meta_data->>'provider';
  v_subject text;
  v_canary uuid;
  v_scoped_flow boolean:=false;
  v_flow_hash text;
  v_admission public.account_signup_admissions%rowtype;
begin

  if v_provider is distinct from 'email' and not public.account_signup_enforcement_is_enabled() then return new; end if;
  if v_provider = 'email' then
    v_subject := lower(btrim(new.email));
    v_flow_hash := encode(sha256(convert_to(new.raw_user_meta_data->>'signup_admission_token','UTF8')),'hex');
  elsif v_provider in ('google','apple') then
    v_subject := new.raw_user_meta_data->>'sub';
  else
    raise exception 'signup_eligibility_required';
  end if;
  if v_provider='email' then
    select c.id into v_canary from public.account_signup_canaries c
      where c.target_email=v_subject and c.expires_at>clock_timestamp();
    select exists(select 1 from public.account_signup_admissions a
      where a.provider='email' and a.subject=v_subject and a.flow_hash=v_flow_hash
        and a.canary_scope_id is not null) into v_scoped_flow;
  end if;
  if not public.account_signup_enforcement_is_enabled() and v_canary is null and not v_scoped_flow then return new; end if;
  select a.* into v_admission from public.account_signup_admissions a
    where a.provider = v_provider and a.subject = v_subject
      and (v_provider <> 'email' or a.flow_hash = v_flow_hash)
      and (v_canary is null or a.canary_scope_id=v_canary)
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

-- A consumed scoped grant keeps the insert guarded even when scope expires between
-- hook and insert. Its own five-minute admission expiry still fails closed.
-- No target is deleted or automatically enrolled in email subscriptions by this SQL.
commit;
