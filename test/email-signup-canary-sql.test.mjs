import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
create table public.mailer_signup_requests(id uuid primary key,token_hash text);
create function public.create_mailer_signup_request(text,text,text,smallint,smallint,text,text,text,text) returns table(result_state text,request_id uuid,retry_after_seconds integer) language sql as $$select 'created'::text,null::uuid,0$$;
create function public.confirm_mailer_signup(text) returns table(result_state text,subscriber_id uuid,timezone text,send_hour_local smallint,send_minute_local smallint) language sql as $$select 'active'::text,null::uuid,'UTC'::text,8::smallint,0::smallint$$;`);
await db.exec(await readFile(new URL('../supabase/migrations/20261118193907_stage_dormant_account_age_eligibility.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261118211004_email_signup_canary.sql',import.meta.url),'utf8'));
let serial=0;
const uuid=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++serial).padStart(12,'0')}`;
const hash=s=>createHash('sha256').update(s).digest('hex');
async function insert(email,proof,provider='email'){
 const id=uuid();await db.query('insert into auth.users values($1,$2,$3,$4)',[id,email,JSON.stringify({provider}),JSON.stringify({signup_admission_token:proof})]);return id;
}
async function scope(email){const operator=await insert(`operator-${serial}@example.test`);const id=uuid();await db.query("insert into public.account_signup_canaries(id,operator_id,target_email,expires_at) values($1,$2,$3,clock_timestamp()+interval '1 hour')",[id,operator,email]);return{id,operator,email};}
async function issue(c,proof='proof'){return db.query("select public.issue_signup_canary_admission($1,$2,$3,'US','us-independent-13-v1',13,'adult') as target",[c.operator,c.id,hash(proof)]);}
async function hook(email,proof,provider='email'){
 const event={user:{email,app_metadata:{provider},user_metadata:{signup_admission_token:proof}}};
 return (await db.query('select public.before_user_created_eligibility($1::jsonb) as result',[JSON.stringify(event)])).rows[0].result;
}
async function expire(c){await db.query("update public.account_signup_canaries set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' where id=$1",[c.id]);}
test('empty canary scope preserves ordinary signup and every global switch remains false',async()=>{
 assert.deepEqual(await hook('normal@example.test'),{});await insert('normal@example.test');
 assert.deepEqual(await hook('google@example.test',null,'google'),{});await insert('google@example.test',null,'google');
 assert.equal((await db.query('select public.account_signup_enforcement_is_enabled() as enabled')).rows[0].enabled,false);
 assert.equal((await db.query('select enabled from public.account_age_enforcement')).rows[0].enabled,false);
});
test('active exact email scope requires admission while unrelated email and OAuth stay untouched',async()=>{
 const c=await scope('canary-one@example.test');
 assert.ok((await hook(c.email)).error);
 await assert.rejects(()=>insert(c.email),/signup_eligibility_required/);
 assert.deepEqual(await hook('unrelated@example.test'),{});await insert('unrelated@example.test');
 assert.deepEqual(await hook(c.email,null,'apple'),{});
 assert.ok((await hook('  CANARY-ONE@EXAMPLE.TEST  ')).error);
});
test('only service can read scope or issue, and wrong operator/scope/expired/existing target denied',async()=>{
 const c=await scope('canary-two@example.test');
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from public.get_signup_canary($1)',[c.operator]),/permission denied/);
  await assert.rejects(()=>issue(c),/permission denied/);
  await assert.rejects(()=>db.query('select * from public.account_signup_canaries'),/permission denied/);
  await db.exec('reset role');
 }
 await assert.rejects(()=>issue({...c,operator:uuid()}),/canary_unavailable/);
 await assert.rejects(()=>issue({...c,id:uuid()}),/canary_unavailable/);
 const existing=await scope('normal@example.test');await assert.rejects(()=>issue(existing),/canary_target_already_registered/);
 await expire(c);await assert.rejects(()=>issue(c),/canary_unavailable/);
 assert.deepEqual(await hook(c.email),{});
});
test('one operator-bound issuance returns only canonical target and cannot be repeated',async()=>{
 const c=await scope('canary-three@example.test');
 await db.exec('set role service_role');
 const visible=await db.query('select * from public.get_signup_canary($1)',[c.operator]);assert.equal(visible.rows[0].canary_id,c.id);
 assert.equal((await issue(c,'one')).rows[0].target,c.email);
 await assert.rejects(()=>issue(c,'two'),/canary_unavailable/);
 assert.equal((await db.query('select * from public.get_signup_canary($1)',[c.operator])).rows.length,0);
 await db.exec('reset role');
 assert.ok((await hook(c.email,'wrong')).error);
 assert.deepEqual(await hook(c.email,'one'),{});
 assert.ok((await hook(c.email,'one')).error);
 const id=await insert(c.email,'one');
 assert.equal((await db.query('select status from public.account_eligibility where user_id=$1',[id])).rows[0].status,'eligible');
 await assert.rejects(()=>insert(c.email,'one'),/signup_eligibility_required/);
});
test('expiry before hook fails scoped flow; expiry after consumed hook never silently bypasses binding',async()=>{
 const first=await scope('canary-expired@example.test');await issue(first,'expired');await expire(first);
 assert.ok((await hook(first.email,'expired')).error);
 await assert.rejects(()=>insert(first.email,'expired'),/signup_eligibility_required/);
 const c=await scope('canary-cross-expiry@example.test');await issue(c,'cross');assert.deepEqual(await hook(c.email,'cross'),{});
 await expire(c);
 const id=await insert(c.email,'cross');
 assert.equal((await db.query('select count(*)::int as n from public.account_eligibility where user_id=$1',[id])).rows[0].n,1);
});
test('expired grant after consumed hook fails closed even when scope also expired',async()=>{
 const c=await scope('canary-grant-expired@example.test');await issue(c,'grant');assert.deepEqual(await hook(c.email,'grant'),{});await expire(c);
 await db.query("update public.account_signup_admissions set expires_at=clock_timestamp()-interval '1 second' where canary_scope_id=$1",[c.id]);
 await assert.rejects(()=>insert(c.email,'grant'),/signup_eligibility_required/);
});
test('canary rollback restores prior hooks while retaining proof/scope/account rows',async()=>{
 const before=(await db.query('select (select count(*) from auth.users)::int as users,(select count(*) from public.account_signup_canaries)::int as scopes,(select count(*) from public.account_eligibility)::int as decisions')).rows[0];
 await db.exec(await readFile(new URL('../scripts/age/end-email-signup-canary.sql',import.meta.url),'utf8'));
 const after=(await db.query('select (select count(*) from auth.users)::int as users,(select count(*) from public.account_signup_canaries)::int as scopes,(select count(*) from public.account_eligibility)::int as decisions')).rows[0];
 assert.deepEqual(after,before);
 assert.deepEqual(await hook('canary-one@example.test'),{});
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select * from public.get_signup_canary($1)',[uuid()]),/permission denied/);
 await db.exec('reset role');
});
test.after(async()=>{await db.close();});
