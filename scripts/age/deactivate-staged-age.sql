-- OPERATOR-ONLY emergency deactivation. Does not delete accounts, eligibility
-- evidence, subscriptions, added columns, or pre-existing policies.
-- Also disable Vercel age flags and unconfigure the Auth hook before normal signup.
begin;
update public.account_signup_enforcement set enabled=false where singleton;
update public.account_age_enforcement set enabled=false where singleton;
drop trigger if exists bind_new_account_eligibility on auth.users;
do $$
declare r record;
begin
 for r in select schemaname,tablename from pg_policies
   where policyname='account_age_access' and schemaname in ('public','storage')
 loop
   execute format('drop policy account_age_access on %I.%I',r.schemaname,r.tablename);
 end loop;
end $$;
commit;
