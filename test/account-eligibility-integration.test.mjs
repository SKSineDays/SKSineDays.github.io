import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('dashboard gates before private loads and aborts on auth switch before modal',async()=>{
 const s=await readFile(new URL('../js/dashboard.js',import.meta.url),'utf8');
 const gate=s.indexOf('allowed = await ensureAccountEligibility');
 assert.ok(s.indexOf('const gateSubscription = await onAuthStateChange')<gate);
 assert.ok(s.indexOf('publicConfig.accountEligibilityEnabled === true')<gate);
 assert.ok(gate<s.indexOf('userSettings = await loadUserSettings'));
 assert.match(s,/signal: gateAbort.signal/); assert.match(s,/gateSubscription\?\.unsubscribe/);
});
test('safe billing reconciliation requires affirmative checkout owner match',async()=>{
 const s=await readFile(new URL('../api/sync-subscription-status.js',import.meta.url),'utf8');
 assert.match(s,/if \(!sessionUserId \|\| sessionUserId !== user.id\)/);
});
