import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
const migration=await readFile(new URL('../supabase/migrations/20261118190000_independent_signup_eligibility.sql',import.meta.url),'utf8');
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
grant usage on schema auth to authenticated;
create table public.protected_test(id integer primary key);
alter table public.protected_test enable row level security;
grant select,insert,update,delete on public.protected_test to authenticated;
create policy test_allow on public.protected_test to authenticated using(true) with check(true);
insert into public.protected_test values(1);
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
create table public.mailer_signup_requests(id uuid primary key, token_hash text);
create function public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text)
returns table(result_state text,request_id uuid,retry_after_seconds integer) language sql as $$ select 'created'::text,null::uuid,0 $$;
create function public.confirm_mailer_signup(text)
returns table(result_state text,subscriber_id uuid,timezone text,send_hour_local smallint,send_minute_local smallint)
language sql as $$ select 'active'::text,null::uuid,'UTC'::text,8::smallint,0::smallint $$;
insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy@example.test','{"provider":"email"}','{}');`);
await db.exec(migration);
let count=0;
const sha=value=>createHash('sha256').update(value).digest('hex');
async function admission(provider,subject,proof) {
 return db.query('select public.issue_account_admission($1,$2,$3,$4,$5,$6,$7)',[provider,subject,sha(proof),'US','us-independent-13-v1',13,'adult']);
}
async function hook(provider,subject,proof) {
 const user={email:provider==='email'?subject:'example@test.test',app_metadata:{provider},user_metadata:provider==='email'?{signup_admission_token:proof}:{sub:subject}};
 const result=await db.query('select public.before_user_created_eligibility($1::jsonb) as result',[JSON.stringify({user})]);
 return result.rows[0].result;
}
async function insertUser(provider,subject,proof) {
 const id=`bbbbbbbb-bbbb-4bbb-8bbb-${String(++count).padStart(12,'0')}`;
 await db.query('insert into auth.users values($1,$2,$3,$4)',[id,provider==='email'?subject:'example@test.test',JSON.stringify({provider}),JSON.stringify(provider==='email'?{signup_admission_token:proof}:{sub:subject})]);
 return id;
}
test('anonymous/authenticated cannot issue admissions, write proofs, or invoke hook',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>admission('email','a@test.test','x'),/permission denied/);
  await assert.rejects(()=>hook('email','a@test.test','x'),/permission denied/);
  await assert.rejects(()=>db.query('select * from public.account_eligibility'),/permission denied/);
  await db.exec('reset role');
 }
});
test('no grant, wrong email proof, and wrong subject all denied',async()=>{
 assert.ok((await hook('email','bad@test.test','missing')).error);
 await admission('email','right@test.test','proof1');
 assert.ok((await hook('email','right@test.test','wrong')).error);
 assert.ok((await hook('email','other@test.test','proof1')).error);
 assert.ok((await hook('github','right@test.test','proof1')).error);
});
test('email hook consumes exactly once; final auth insert binds trusted age record',async()=>{
 await admission('email','adult@test.test','proof2');
 assert.deepEqual(await hook('email','adult@test.test','proof2'),{});
 assert.ok((await hook('email','adult@test.test','proof2')).error);
 const id=await insertUser('email','adult@test.test','proof2');
 const result=await db.query('select * from public.account_eligibility where user_id=$1',[id]);
 assert.equal(result.rows[0].method,'self_declared');
 assert.equal(result.rows[0].minimum_age,13);
 await assert.rejects(()=>insertUser('email','adult@test.test','proof2'),/signup_eligibility_required/);
});
test('Google/Apple bind by provider subject, including private relay independent of email',async()=>{
 for(const provider of ['google','apple']) {
  await admission(provider,provider+'-subject','proof-'+provider);
  assert.ok((await hook(provider,'wrong-subject')).error);
  assert.deepEqual(await hook(provider,provider+'-subject'),{});
  const id=await insertUser(provider,provider+'-subject');
  assert.equal((await db.query('select user_id from public.account_eligibility where user_id=$1',[id])).rows.length,1);
 }
});
test('trigger rejects direct creation when hook is bypassed; legacy row remains unchanged',async()=>{
 await admission('google','bypass-subject','proof-bypass');
 await assert.rejects(()=>insertUser('google','bypass-subject'),/signup_eligibility_required/);
 const result=await db.query("select * from auth.users where email='legacy@example.test'");
 assert.equal(result.rows.length,1);
 assert.equal((await db.query("select * from public.account_eligibility where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows.length,0);
});
test('expired admissions and duplicate flows fail',async()=>{
 await admission('email','expire@test.test','proof-expire');
 await db.query("update public.account_signup_admissions set expires_at=clock_timestamp()-interval '1 second' where subject='expire@test.test'");
 assert.ok((await hook('email','expire@test.test','proof-expire')).error);
 await assert.rejects(()=>admission('email','different@test.test','proof-expire'),/duplicate key/);
});
test('old public mailer confirmation token without eligibility cannot activate',async()=>{
 await db.query("insert into public.mailer_signup_requests values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','old',null,null,null,null,null)");
 const result=await db.query("select * from public.confirm_eligible_mailer_signup('old','{}')");
 assert.equal(result.rows[0].result_state,'eligibility_required');
});
test('subject admission issuance is rate limited',async()=>{
 for(let i=0;i<5;i++) await admission('email','limit@test.test','limit'+i);
 await assert.rejects(()=>admission('email','limit@test.test','limit6'),/signup_rate_limited/);
});
test.after(()=>db.close());

test('pending mailer token must match currently approved country and policy version',async()=>{
 await db.query("insert into public.mailer_signup_requests values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','screened','US','us-independent-13-v1',13,'adult',clock_timestamp())");
 const policies=JSON.stringify({US:{version:'us-independent-13-v1',minimumAge:13}});
 assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)', ['screened',policies])).rows[0].result_state,'active');
 for(const changed of [{},{US:{version:'us-v2',minimumAge:13}},{US:{version:'us-independent-13-v1',minimumAge:16}}]) {
  assert.equal((await db.query('select * from public.confirm_eligible_mailer_signup($1,$2)',['screened',JSON.stringify(changed)])).rows[0].result_state,'eligibility_required');
 }
});
test('scheduled admission cleanup removes expired subjects without deleting account eligibility',async()=>{
 await db.query("update public.account_signup_admissions set expires_at=clock_timestamp()-interval '2 days'");
 const before=(await db.query('select count(*)::integer as n from public.account_eligibility')).rows[0].n;
 await db.query('select public.cleanup_account_admissions()');
 assert.equal((await db.query('select count(*)::integer as n from public.account_signup_admissions')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::integer as n from public.account_eligibility')).rows[0].n,before);
});

test('legacy underage decision is immutable and cannot be overwritten by adult resubmission',async()=>{
 const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const args=[user,'US','us-independent-13-v1',13,'under13',false];
 const first=await db.query('select * from public.record_account_eligibility_decision($1,$2,$3,$4,$5,$6)',args);
 assert.equal(first.rows[0].status,'review_required');
 args[4]='adult';args[5]=true;
 const retry=await db.query('select * from public.record_account_eligibility_decision($1,$2,$3,$4,$5,$6)',args);
 assert.equal(retry.rows[0].status,'review_required');assert.equal(retry.rows[0].age_band,'under13');
 for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from public.record_account_eligibility_decision($1,$2,$3,$4,$5,$6)',args),/permission denied/);
  await db.exec('reset role');
 }
});

test('restrictive policies deny existing missing/rejected owners despite permissive table policy',async()=>{
 await db.exec("update public.account_age_enforcement set enabled=true; select set_config('test.user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false); set role authenticated");
 assert.equal((await db.query('select * from public.protected_test')).rows.length,0);
 await assert.rejects(()=>db.exec('insert into public.protected_test values(2)'),/row-level security/);
 await assert.rejects(()=>db.exec('update public.account_age_enforcement set enabled=false'),/permission denied/);
 await db.exec('reset role');
 const eligible=await db.query("select user_id from public.account_eligibility where status='eligible' limit 1");
 await db.query("select set_config('test.user_id',$1,false)",[eligible.rows[0].user_id]);
 await db.exec('set role authenticated');
 assert.equal((await db.query('select * from public.protected_test')).rows.length,1);
 await db.exec('reset role');
 await db.exec("update public.account_age_policy_config set policy_version='withdrawn'; set role authenticated");
 assert.equal((await db.query('select * from public.protected_test')).rows.length,0);
 await db.exec('reset role');
});
