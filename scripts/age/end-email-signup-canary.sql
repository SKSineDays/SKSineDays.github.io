-- End email-only canary without deleting accounts, admissions, scopes or decisions.
-- Disable SIGNUP_CANARY_ENABLED first. This restores the prior dormant/global policy.
-- If global signup is false, this ends canary protection; do not present it as active.
begin;
revoke execute on function public.get_signup_canary(uuid) from service_role;
revoke execute on function public.issue_signup_canary_admission(uuid,uuid,text,text,text,integer,text) from service_role;
create or replace function public.before_user_created_eligibility(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := event->'user'->'app_metadata'->>'provider';
  v_subject text;
  v_flow_hash text;
  v_id uuid;
begin
  if not public.account_signup_enforcement_is_enabled() then return '{}'::jsonb; end if;
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


create or replace function public.bind_new_account_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_provider text := new.raw_app_meta_data->>'provider';
  v_subject text;
  v_flow_hash text;
  v_admission public.account_signup_admissions%rowtype;
begin
  if not public.account_signup_enforcement_is_enabled() then return new; end if;
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

commit;
