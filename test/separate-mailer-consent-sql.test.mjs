import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_MAILER_POLICIES } from '../api/_lib/mailer-eligibility.js';
const age = await readFile(new URL('../supabase/migrations/20261118193907_stage_dormant_account_age_eligibility.sql',import.meta.url),'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261118205950_stage_dormant_mailer_age_enforcement.sql',import.meta.url),'utf8');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
create table public.mailer_signup_requests(id uuid primary key,token_hash text,email text);
create table public.existing_subscribers(id integer primary key,status text); insert into public.existing_subscribers values(1,'active');
create function public.create_mailer_signup_request(p_token_hash text,p_email text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,p_consent_version text,p_source text,p_recipient_key_hash text,p_ip_key_hash text)
returns table(result_state text,request_id uuid,retry_after_seconds integer) language plpgsql as $$ declare v_id uuid:=gen_random_uuid(); begin insert into public.mailer_signup_requests values(v_id,p_token_hash,p_email); return query select 'created'::text,v_id,0; end $$;
create function public.confirm_mailer_signup(p_token_hash text) returns table(result_state text,subscriber_id uuid,timezone text,send_hour_local smallint,send_minute_local smallint) language sql as $$select 'active'::text,null::uuid,'UTC'::text,8::smallint,0::smallint$$;
create function public.activate_authenticated_email_subscriber(p_email text,p_recipient_key_hash text,p_timezone text,p_birth_day_of_year smallint,p_origin_day smallint,p_consent_version text,p_source text)
returns table(result_state text,subscriber_id uuid,profile_configured boolean,origin_day smallint) language sql as $$select 'active'::text,null::uuid,true,1::smallint$$;`);
await db.exec(age);
await db.exec(migration);
const split = await readFile(new URL('../supabase/migrations/20261118213202_separate_mailer_consent_policy.sql',import.meta.url),'utf8');
// A failed/abandoned migration must leave no new tables or changed wrapper definitions.
const originalBody=(await db.query("select pg_get_functiondef('public.activate_eligible_authenticated_email_subscriber(uuid,text,text,text,smallint,smallint,text,text)'::regprocedure) as body")).rows[0].body;
await db.exec('begin;'+split.replace(/\bbegin;/,'').replace(/commit;\s*$/,'')+'rollback;');
assert.equal((await db.query("select to_regclass('public.account_mailer_eligibility') as t")).rows[0].t,null);
assert.equal((await db.query("select pg_get_functiondef('public.activate_eligible_authenticated_email_subscriber(uuid,text,text,text,smallint,smallint,text,text)'::regprocedure) as body")).rows[0].body,originalBody);
await db.exec(split);
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rejected='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const knownChild='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const accountOnly='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
await db.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,'adult@example.test','{}','{}'),($2,'rejected@example.test','{}','{}'),($3,'child@example.test','{}','{}'),($4,'account@example.test','{}','{}')",[user,rejected,knownChild,accountOnly]);
const record=(id,country,version,min,band,eligible)=>db.query('select * from public.record_mailer_eligibility_decision($1,$2,$3,$4,$5,$6)',[id,country,version,min,band,eligible]);
const activate=(id,email)=>db.query("select * from public.activate_eligible_authenticated_email_subscriber($1,$2,'recipient','UTC',1::smallint,1::smallint,'v1','test')",[id,email]);
const create=(country,version,min,band,token)=>db.query("select * from public.create_eligible_mailer_signup_request($1,'public@example.test','UTC',1::smallint,1::smallint,'v1','test','recipient','ip',$2,$3,$4,$5)",[token,country,version,min,band]);

test('separate mailer map contains US and 27 EU policies; dormant delivery untouched',async()=>{
 const rows=(await db.query('select * from public.mailer_age_policy_config order by country')).rows;
 assert.equal(rows.length,28);
 assert.deepEqual(Object.fromEntries(rows.map(r=>[r.country,{minimumAge:r.minimum_age,version:r.policy_version}])),DEFAULT_MAILER_POLICIES);
 assert.equal(rows.find(x=>x.country==='DK').minimum_age,15);
 assert.equal(rows.find(x=>x.country==='US').policy_version,'us-independent-13-v1');
 assert.equal((await db.query('select public.mailer_age_enforcement_is_enabled() enabled')).rows[0].enabled,false);
 assert.deepEqual((await db.query('select * from public.existing_subscribers')).rows,[{id:1,status:'active'}]);
 assert.equal((await db.query("select * from public.confirm_mailer_signup('old')")).rows[0].result_state,'active');
});

test('untrusted roles cannot read proof/config or call service-only functions',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const sql of ['select * from public.account_mailer_eligibility','select * from public.mailer_age_policy_config',`select * from public.record_mailer_eligibility_decision('${user}','US','us-independent-13-v1',13,'adult',true)`,`select * from public.activate_eligible_authenticated_email_subscriber('${user}','adult@example.test','r','UTC',1::smallint,1::smallint,'v','s')`]) await assert.rejects(()=>db.query(sql),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query("update public.account_mailer_eligibility set status='eligible'"),/permission denied/);
 await assert.rejects(()=>db.query('delete from public.account_mailer_eligibility'),/permission denied/);
 await db.exec('reset role');
});

test('new immutable consent proof is distinct from account13 and cannot be overwritten',async()=>{
 await db.exec('set role service_role');
 const denied=(await record(rejected,'ES','eu-mailer-consent-14-v1',14,'13-15',false)).rows[0];
 assert.equal(denied.status,'review_required');
 const retry=(await record(rejected,'ES','eu-mailer-consent-14-v1',14,'adult',true)).rows[0];
 assert.equal(retry.status,'review_required'); assert.equal(retry.age_band,'13-15');
 await assert.rejects(()=>activate(rejected,'rejected@example.test'),/mailer_age_eligibility_required/);
 const approved=(await record(user,'ES','eu-mailer-consent-14-v1',14,'13-15',true)).rows[0];
 assert.equal(approved.status,'eligible');
 assert.equal((await activate(user,'adult@example.test')).rows[0].result_state,'active');
 await assert.rejects(()=>activate(user,'other@example.test'),/mailer_age_eligibility_required/);
 await db.exec('reset role');
});

test('account13 alone and known rejected account cannot authorize mailer',async()=>{
 await db.query("insert into public.account_eligibility(user_id,country,policy_version,minimum_age,age_band,status) values($1,'US','us-independent-13-v1',13,'adult','eligible'),($2,'US','us-independent-13-v1',13,'under13','review_required')",[accountOnly,knownChild]);
 await db.exec('set role service_role');
 await assert.rejects(()=>activate(accountOnly,'account@example.test'),/mailer_age_eligibility_required/);
 await assert.rejects(()=>record(knownChild,'US','us-independent-13-v1',13,'adult',true),/account_eligibility_review_required/);
 await assert.rejects(()=>record(accountOnly,'US','us-independent-13-v1',13,'under13',true),/check constraint/);
 await assert.rejects(()=>record(accountOnly,'IE','eu-mailer-consent-16-v1',16,'13-15',true),/check constraint/);
 await assert.rejects(()=>record(accountOnly,'ZZ','bogus',13,'adult',true),/mailer_policy_unavailable/);
 await db.exec('reset role');
});

test('public requests use mailer-specific proof, reject baseline and impossible bands; confirmation rechecks policy',async()=>{
 await db.exec('set role service_role');
 await assert.rejects(()=>create('ES','independent-baseline-13-v1',13,'13-15','bad'),/signup_eligibility_required/);
 await assert.rejects(()=>create('IE','eu-mailer-consent-16-v1',16,'13-15','bad'),/signup_eligibility_required/);
 await assert.rejects(()=>create('US','us-independent-13-v1',13,'under13','bad'),/signup_eligibility_required/);
 await assert.rejects(()=>create('ZZ','bad',13,'adult','bad'),/signup_eligibility_required/);
 assert.equal((await create('ES','eu-mailer-consent-14-v1',14,'13-15','es-proof')).rows[0].result_state,'created');
 assert.equal((await create('US','us-independent-13-v1',13,'adult','us-proof')).rows[0].result_state,'created');
 const policies=JSON.stringify({ES:{minimumAge:14,version:'eu-mailer-consent-14-v1'},US:{minimumAge:13,version:'us-independent-13-v1'}});
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['es-proof',policies])).rows[0].result_state,'active');
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['us-proof',policies])).rows[0].result_state,'active');
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['es-proof','{}'])).rows[0].result_state,'eligibility_required');
 await db.exec('reset role');
 await db.query("update public.mailer_age_policy_config set policy_version='withdrawn' where country='ES'");
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['es-proof',policies])).rows[0].result_state,'eligibility_required');
 await assert.rejects(()=>activate(user,'adult@example.test'),/mailer_age_eligibility_required/);
});

test('confirmation rejects inconsistent historic or manual proof bands',async()=>{
 await db.query("insert into public.mailer_signup_requests(id,token_hash,email,eligibility_country,eligibility_policy_version,eligibility_minimum_age,eligibility_age_band,eligibility_checked_at) values(gen_random_uuid(),'inconsistent-ie','independent@example.test','IE','eu-mailer-consent-16-v1',16,'13-15',clock_timestamp())");
 const policy=JSON.stringify({IE:{minimumAge:16,version:'eu-mailer-consent-16-v1'}});
 await db.exec('set role service_role');
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['inconsistent-ie',policy])).rows[0].result_state,'eligibility_required');
 await db.exec('reset role');
});

test('anonymous signup and confirmation cannot bypass a known denial for the exact email',async()=>{
 const direct=(email,token)=>db.query("select * from public.create_eligible_mailer_signup_request($1,$2,'UTC',1::smallint,1::smallint,'v1','test','recipient','ip','US','us-independent-13-v1',13,'adult')",[token,email]);
 await db.exec('set role service_role');
 await assert.rejects(()=>direct('child@example.test','child-bypass'),/mailer_age_eligibility_required/);
 await assert.rejects(()=>direct('  REJECTED@example.test  ','mailer-bypass'),/mailer_age_eligibility_required/);
 await db.exec('reset role');
 // A refusal recorded after the original request must also prevent confirmation.
 await db.query("update public.mailer_signup_requests set email='child@example.test' where token_hash='us-proof'");
 const policy=JSON.stringify({US:{minimumAge:13,version:'us-independent-13-v1'}});
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['us-proof',policy])).rows[0].result_state,'eligibility_required');
});

test('normal flag rollback preserves all account, subscriber and decision records',async()=>{
 await db.exec('update public.mailer_age_enforcement set enabled=true');
 await assert.rejects(()=>db.query("select * from public.confirm_mailer_signup('old')"),/mailer_age_eligibility_required/);
 await db.exec('update public.mailer_age_enforcement set enabled=false');
 assert.equal((await db.query("select * from public.confirm_mailer_signup('old')")).rows[0].result_state,'active');
 assert.deepEqual((await db.query('select * from public.existing_subscribers')).rows,[{id:1,status:'active'}]);
 assert.equal((await db.query('select count(*)::int n from public.account_mailer_eligibility')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,4);
});
test.after(async()=>{await db.close();});
