import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const age = await readFile(new URL('../supabase/migrations/20261118193907_stage_dormant_account_age_eligibility.sql',import.meta.url),'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261118205950_stage_dormant_mailer_age_enforcement.sql',import.meta.url),'utf8');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
create table public.mailer_signup_requests(id uuid primary key,token_hash text);
create table public.existing_subscribers(id integer primary key,status text); insert into public.existing_subscribers values(1,'active');
create function public.create_mailer_signup_request(p_token_hash text,p_email text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,p_consent_version text,p_source text,p_recipient_key_hash text,p_ip_key_hash text)
returns table(result_state text,request_id uuid,retry_after_seconds integer) language plpgsql as $$ declare v_id uuid:=gen_random_uuid(); begin insert into public.mailer_signup_requests values(v_id,p_token_hash); return query select 'created'::text,v_id,0; end $$;
create function public.confirm_mailer_signup(p_token_hash text) returns table(result_state text,subscriber_id uuid,timezone text,send_hour_local smallint,send_minute_local smallint) language sql as $$select 'active'::text,null::uuid,'UTC'::text,8::smallint,0::smallint$$;
create function public.activate_authenticated_email_subscriber(p_email text,p_recipient_key_hash text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,p_consent_version text,p_source text)
returns table(result_state text,subscriber_id uuid,profile_configured boolean,origin_day smallint) language sql as $$select 'active'::text,null::uuid,true,1::smallint$$;`);
await db.exec(age);
const originalOid=(await db.query("select 'public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text)'::regprocedure::oid as oid")).rows[0].oid;
// Explicit transaction proves failed/abandoned installation leaves original names intact.
await db.exec('begin;'+migration.replace(/\bbegin;/,'').replace(/commit;\s*$/,'')+'rollback;');
assert.equal((await db.query("select to_regclass('public.mailer_age_enforcement') as t")).rows[0].t,null);
assert.equal((await db.query("select 'public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text)'::regprocedure::oid as oid")).rows[0].oid,originalOid);
await db.exec(migration);
const create=(name,token='test')=>db.query(`select * from ${name}($1,'person@example.test','UTC',1::smallint,1::smallint,'v1','test','recipient','ip')`,[token]);
const activate=name=>db.query(`select * from public.${name}('person@example.test','recipient','UTC',1::smallint,1::smallint,'v1','test')`);
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('dormant migration preserves original OID privately and legacy service behavior',async()=>{
 assert.equal((await db.query("select 'sineday_mailer_internal.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text)'::regprocedure::oid as oid")).rows[0].oid,originalOid);
 await db.exec('set role service_role');
 assert.equal((await db.query('select public.mailer_age_enforcement_is_enabled() as enabled')).rows[0].enabled,false);
 assert.equal((await create('public.create_mailer_signup_request','legacy')).rows[0].result_state,'created');
 assert.equal((await db.query("select * from public.confirm_mailer_signup('legacy')")).rows[0].result_state,'active');
 assert.equal((await activate('activate_authenticated_email_subscriber')).rows[0].result_state,'active');
 await db.exec('reset role');
});
test('untrusted roles cannot query flags, invoke wrappers or reach private originals; service cannot call private originals',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const sql of ['select public.mailer_age_enforcement_is_enabled()','update public.mailer_age_enforcement set enabled=true',"select * from public.confirm_mailer_signup('x')", "select * from public.confirm_eligible_mailer_signup('x','{}')", "select * from sineday_mailer_internal.confirm_mailer_signup('x')"])
   await assert.rejects(()=>db.query(sql),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query("select * from sineday_mailer_internal.confirm_mailer_signup('x')"),/permission denied/);
 await db.exec('reset role');
});
test('enabled switch blocks all legacy activation paths without changing pending or active rows',async()=>{
 await db.exec('update public.mailer_age_enforcement set enabled=true; set role service_role');
 await assert.rejects(()=>create('public.create_mailer_signup_request','blocked'),/mailer_age_eligibility_required/);
 await assert.rejects(()=>db.query("select * from public.confirm_mailer_signup('legacy')"),/mailer_age_eligibility_required/);
 await assert.rejects(()=>activate('activate_authenticated_email_subscriber'),/mailer_age_eligibility_required/);
 await db.exec('reset role');
 assert.deepEqual((await db.query('select token_hash from public.mailer_signup_requests')).rows,[{token_hash:'legacy'}]);
 assert.deepEqual((await db.query('select * from public.existing_subscribers')).rows,[{id:1,status:'active'}]);
});
test('eligible public wrappers use private implementation and reject missing or withdrawn proof',async()=>{
 await db.exec('set role service_role');
 const sql=`select * from public.create_eligible_mailer_signup_request($1,'person@example.test','UTC',1::smallint,1::smallint,'v1','test','recipient','ip','US',$2,13,'adult')`;
 await assert.rejects(()=>db.query(sql,['bad','unknown-policy']),/signup_eligibility_required/);
 assert.equal((await db.query(sql,['proof','us-independent-13-v1'])).rows[0].result_state,'created');
 const policy=JSON.stringify({US:{minimumAge:13,version:'us-independent-13-v1'}});
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['proof',policy])).rows[0].result_state,'active');
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['legacy',policy])).rows[0].result_state,'eligibility_required');
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['proof','{}'])).rows[0].result_state,'eligibility_required');
 await db.exec('reset role');
 await db.query("update public.account_age_policy_config set policy_version='withdrawn'");
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['proof',policy])).rows[0].result_state,'eligibility_required');
 await db.query("update public.account_age_policy_config set policy_version='us-independent-13-v1'");
});
test('authenticated eligible wrapper binds owner email and denies missing/rejected evidence',async()=>{
 await db.query("insert into auth.users values($1,'person@example.test','{}','{}')",[user]);
 const sql=`select * from public.activate_eligible_authenticated_email_subscriber($1,$2,'recipient','UTC',1::smallint,1::smallint,'v1','test')`;
 await assert.rejects(()=>db.query(sql,[user,'person@example.test']),/mailer_age_eligibility_required/);
 await db.query("insert into public.account_eligibility(user_id,country,policy_version,minimum_age,age_band,status) values($1,'US','us-independent-13-v1',13,'under13','review_required')",[user]);
 await assert.rejects(()=>db.query(sql,[user,'person@example.test']),/mailer_age_eligibility_required/);
 await db.query("update public.account_eligibility set age_band='adult',status='eligible' where user_id=$1",[user]);
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query(sql,[user,'someone-else@example.test']),/mailer_age_eligibility_required/);
 assert.equal((await db.query(sql,[user,'person@example.test'])).rows[0].result_state,'active');
 await db.exec('reset role');
});
test('non-destructive deactivation restores old routes and retains all existing/proof rows',async()=>{
 const before=(await db.query('select count(*)::int as n from public.mailer_signup_requests')).rows[0].n;
 await db.exec('update public.mailer_age_enforcement set enabled=false; set role service_role');
 assert.equal((await db.query("select * from public.confirm_mailer_signup('legacy')")).rows[0].result_state,'active');
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int as n from public.mailer_signup_requests')).rows[0].n,before);
 assert.equal((await db.query('select count(*)::int as n from public.account_eligibility')).rows[0].n,1);
 assert.deepEqual((await db.query('select * from public.existing_subscribers')).rows,[{id:1,status:'active'}]);
});
test('DDL reversal restores original public OID and leaves data and readiness intact',async()=>{
 const rollback=await readFile(new URL('../scripts/age/restore-legacy-mailer-routing.sql',import.meta.url),'utf8');
 await db.exec(rollback);
 assert.equal((await db.query("select 'public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text)'::regprocedure::oid as oid")).rows[0].oid,originalOid);
 assert.equal((await db.query('select count(*)::int as n from public.account_eligibility')).rows[0].n,1);
 assert.equal((await db.query('select public.mailer_age_enforcement_is_enabled() as enabled')).rows[0].enabled,false);
 assert.equal((await db.query("select * from public.confirm_mailer_signup('legacy')")).rows[0].result_state,'active');
});
test.after(async()=>{ await db.close(); });
