begin;
set local lock_timeout='3s'; set local statement_timeout='20s';
do $test$
declare v_id uuid:=gen_random_uuid(); v_new uuid:=gen_random_uuid(); v_email text:='age-stage-'||gen_random_uuid()::text||'@example.invalid'; v_proof text:=gen_random_uuid()::text; v_result jsonb; denied boolean:=false;
begin
 if (select enabled from public.account_signup_enforcement) or (select enabled from public.account_age_enforcement) then raise exception 'stage_must_be_dormant'; end if;
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_id,'legacy-'||v_email,'{"provider":"email"}','{}');
 if exists(select 1 from public.account_eligibility where user_id=v_id) then raise exception 'dormant_trigger_wrote_decision'; end if;
 perform set_config('request.jwt.claim.sub',v_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_id,'role','authenticated')::text,true);
 if not public.current_account_age_eligible() then raise exception 'dormant_predicate_denied'; end if;
 update public.account_signup_enforcement set enabled=true where singleton;
 v_result:=public.before_user_created_eligibility(jsonb_build_object('user',jsonb_build_object('email',v_email,'app_metadata',jsonb_build_object('provider','email'),'user_metadata','{}'::jsonb)));
 if not(v_result?'error') then raise exception 'no_proof_allowed'; end if;
 begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_new,v_email,'{"provider":"email"}','{}');
 exception when others then if sqlerrm like '%signup_eligibility_required%' then denied:=true; else raise; end if; end;
 if not denied then raise exception 'trigger_no_proof_allowed'; end if;
 perform public.issue_account_admission('email',v_email,encode(sha256(convert_to(v_proof,'UTF8')),'hex'),'US','us-independent-13-v1',13,'adult');
 v_result:=public.before_user_created_eligibility(jsonb_build_object('user',jsonb_build_object('email',v_email,'app_metadata',jsonb_build_object('provider','email'),'user_metadata',jsonb_build_object('signup_admission_token',v_proof))));
 if v_result?'error' then raise exception 'valid_hook_denied'; end if;
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_new,v_email,'{"provider":"email"}',jsonb_build_object('signup_admission_token',v_proof));
 if not exists(select 1 from public.account_eligibility where user_id=v_new and status='eligible') then raise exception 'binding_failed'; end if;
 update public.account_age_enforcement set enabled=true where singleton;
 if public.current_account_age_eligible() then raise exception 'missing_owner_allowed'; end if;
 perform public.record_account_eligibility_decision(v_id,'US','us-independent-13-v1',13,'under13',false);
 perform public.record_account_eligibility_decision(v_id,'US','us-independent-13-v1',13,'adult',true);
 if public.current_account_age_eligible() then raise exception 'underage_retry_allowed'; end if;
 perform set_config('request.jwt.claim.sub',v_new::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_new,'role','authenticated')::text,true);
 if not public.current_account_age_eligible() then raise exception 'eligible_owner_denied'; end if;
end $test$;
rollback;
