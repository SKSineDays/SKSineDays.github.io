import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {COUNTRY_CODES,isCountryCode} from '../api/_lib/country-catalog.js';
import {DEFAULT_POLICIES,evaluateEligibility,getConfiguredPolicies} from '../api/_lib/age-eligibility.js';
import policyEndpoint from '../api/eligibility-policy.js';
const now=new Date('2026-11-18T12:00:00Z');
test('explicit249-country catalog has baseline13 with no arbitrary-code fallback',()=>{
 assert.equal(COUNTRY_CODES.length,249);assert.equal(new Set(COUNTRY_CODES).size,249);
 for(const country of COUNTRY_CODES){assert.equal(DEFAULT_POLICIES[country].minimumAge,13);assert.equal(evaluateEligibility({country,birthdate:'2013-11-18',now}).eligible,true);assert.equal(evaluateEligibility({country,birthdate:'2013-11-19',now}).eligible,false);}
 for(const country of ['ZZ','XX','EU','UK','us',''])assert.equal(isCountryCode(country),false);
 assert.equal(DEFAULT_POLICIES.US.version,'us-independent-13-v1');
});
test('oldUS-only server config augments baseline without invalidatingUS proof or restrictingselector',()=>{
 const old=process.env.AGE_ELIGIBILITY_POLICIES_JSON;
 try{process.env.AGE_ELIGIBILITY_POLICIES_JSON=JSON.stringify({US:DEFAULT_POLICIES.US});assert.equal(Object.keys(getConfiguredPolicies()).length,249);
 process.env.AGE_ELIGIBILITY_POLICIES_JSON=JSON.stringify({US:DEFAULT_POLICIES.US,ZZ:{minimumAge:13,version:'v1'}});assert.throws(()=>getConfiguredPolicies());}
 finally{if(old===undefined)delete process.env.AGE_ELIGIBILITY_POLICIES_JSON;else process.env.AGE_ELIGIBILITY_POLICIES_JSON=old;}
});
test('public account selector exposesallcatalog countries sortedbydisplayname',()=>{
 const res={setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 policyEndpoint({method:'GET'},res);assert.equal(res.statusCode,200);assert.equal(res.body.countries.length,249);assert.deepEqual(res.body.countries.map(x=>x.code).sort(),[...COUNTRY_CODES]);
 assert.deepEqual(res.body.countries.map(x=>x.name),res.body.countries.map(x=>x.name).sort((a,b)=>a.localeCompare(b,'en')));
});
test('additiveSQL insertsmatchingbaseline and preservesexistingUSpolicy/user/subscriptiondata',async()=>{
 const db=new PGlite();try{
 await db.exec("create table account_age_policy_config(country text primary key,policy_version text,minimum_age int);insert into account_age_policy_config values('US','us-independent-13-v1',13);create table existing_decisions(value text);insert into existing_decisions values('review_required');create table subscribers(value text);insert into subscribers values('active');");
 const sql=await readFile(new URL('../supabase/migrations/20261118213126_account_baseline13_country_catalog.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const {rows}=await db.query('select * from account_age_policy_config order by country');assert.equal(rows.length,249);
 for(const row of rows)assert.deepEqual({minimumAge:row.minimum_age,version:row.policy_version},DEFAULT_POLICIES[row.country]);
 assert.equal((await db.query('select value from existing_decisions')).rows[0].value,'review_required');assert.equal((await db.query('select value from subscribers')).rows[0].value,'active');
 }finally{await db.close();}
});
