import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { GLOBE_REGIONS } from '../shared/globe-regions.js';

// Real PostgreSQL role/RLS execution, entirely local. Never creates production accounts.
test('globe migration enforces owner RLS, grants, consent, aggregation and deletion', async () => {
  const db = new PGlite();
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      insert into auth.users values ('${A}'),('${B}'),('${C}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260930172350_globe_memberships.sql', import.meta.url), 'utf8'));
    const as = async (role, user = '') => {
      await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
    };
    const rows = async sql => (await db.query(sql)).rows;
    const denied = async (sql, code = '42501') => assert.rejects(db.query(sql), error => error.code === code);
    await as('anon');
    await denied('select * from public.globe_memberships');
    await denied('select * from public.globe_regions');
    await denied('select * from public.globe_region_counts()');
    await as('authenticated', A);
    assert.equal((await rows('select * from public.globe_regions')).length, 249);
    await denied("insert into public.globe_regions values ('ZZ','Fake')");
    await denied('select * from public.globe_region_counts()');
    await denied(`insert into public.globe_memberships(user_id, enabled,region_key,consent_version) values ('${B}',true,'US','2026-09-30')`);
    await denied(`insert into public.globe_memberships(user_id, enabled,region_key) values ('${A}',true,'US')`, '23514');
    await denied(`insert into public.globe_memberships(user_id, enabled,region_key,consent_version) values ('${A}',true,'ZZ','2026-09-30')`, '23503');
    await db.exec(`insert into public.globe_memberships(user_id,enabled,region_key,consent_version,consented_at) values ('${A}',true,'US','2026-09-30','1900-01-01')`);
    const saved = (await rows('select * from public.globe_memberships'))[0];
    assert.notEqual(String(saved.consented_at).slice(0,4), '1900');
    await db.exec(`insert into public.globe_memberships(user_id,enabled,region_key,consent_version) values ('${A}',true,'US','2026-09-30') on conflict(user_id) do update set enabled=excluded.enabled,region_key=excluded.region_key,consent_version=excluded.consent_version`);
    assert.deepEqual((await rows('select consented_at from public.globe_memberships'))[0].consented_at, saved.consented_at);
    await denied(`update public.globe_memberships set user_id='${C}' where user_id='${A}'`);
    await as('authenticated', B);
    assert.equal((await rows('select * from public.globe_memberships')).length, 0);
    assert.equal((await rows(`update public.globe_memberships set enabled=false where user_id='${A}' returning user_id`)).length, 0);
    assert.equal((await rows(`delete from public.globe_memberships where user_id='${A}' returning user_id`)).length, 0);
    await db.exec(`insert into public.globe_memberships(user_id,enabled,region_key,consent_version) values ('${B}',true,'US','2026-09-30')`);
    await as('authenticated', C);
    await db.exec(`insert into public.globe_memberships(user_id) values ('${C}')`);
    await as('service_role');
    assert.deepEqual(await rows('select * from public.globe_region_counts()'), [{ region_key: 'US', member_count: 2 }]);
    await as('authenticated', A);
    await db.exec("update public.globe_memberships set region_key='CA'");
    await as('service_role');
    assert.deepEqual(await rows('select * from public.globe_region_counts()'), [{ region_key: 'CA', member_count: 1 }, { region_key: 'US', member_count: 1 }]);
    await as('authenticated', A);
    await db.exec('delete from public.globe_memberships');
    assert.equal((await rows('select * from public.globe_memberships')).length, 0);
    await db.exec('reset role');
    await db.exec(`delete from auth.users where id='${B}'`);
    await as('service_role');
    assert.deepEqual(await rows('select * from public.globe_region_counts()'), []);
    assert.equal((await rows('select * from public.globe_memberships')).length, 1);
    const plan = await rows('explain (analyze, format json) select * from public.globe_region_counts()');
    console.log('Local aggregate query plan:', JSON.stringify(plan));
    assert.equal(new Set(GLOBE_REGIONS.map(region => region.key)).size, 249);
  } finally { await db.close(); }
});
