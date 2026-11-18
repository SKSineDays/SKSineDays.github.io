import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

for (const state of [true, false, undefined]) {
  test(`browser config carries owner eligibility readiness ${state} into dashboard`, async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      return { ok: true, json: async () => ({ ok: true, accountEligibilityEnabled: state,
        accountRegistrationEnabled: true, mailerEligibilityEnabled: true }) };
    });
    try {
      const { fetchConfig } = await import(`../js/supabase-client.js?owner-config=${state}`);
      const first = await fetchConfig();
      assert.equal(first.accountEligibilityEnabled, state === true);
      assert.equal(first.accountRegistrationEnabled, true);
      assert.equal(first.mailerEligibilityEnabled, true);
      assert.equal(await fetchConfig(), first);
      assert.equal(calls, 1);
    } finally { mock.restoreAll(); }
  });
}
