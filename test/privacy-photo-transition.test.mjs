import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoSelector, PHOTO_HISTORY_KEY, PHOTO_VISIT_KEY } from '../js/day-photo-selection.js';
import { createPrivacyController, PRIVACY_KEY, PRIVACY_TTL } from '../js/privacy-consent.js';

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  const reads = [], writes = [];
  return { data, reads, writes,
    getItem(key) { reads.push(key); return data.get(key) ?? null; },
    setItem(key, value) { writes.push(key); data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}
const at = 1800000000000;
const choice = savedAt => JSON.stringify({ version: 1, savedAt, analytics: false, referrals: true, photos: true });

test('malformed, future and expired choices are removed without reading optional payloads', () => {
  for (const value of ['{broken', choice(at - PRIVACY_TTL), choice(at + 1)]) {
    const local = storage({ [PRIVACY_KEY]: value, 'sb-auth-token': 'keep', [PHOTO_HISTORY_KEY]: 'private', sineday_pending_affiliate_code: 'OLD1' });
    const session = storage({ [PHOTO_VISIT_KEY]: 'private' });
    const controller = createPrivacyController({ local, session, now: () => at });
    assert.equal(controller.get(), null);
    assert.equal(local.data.has(PRIVACY_KEY), false);
    assert.equal(local.data.get('sb-auth-token'), 'keep');
    assert.equal(local.data.has(PHOTO_HISTORY_KEY), false);
    assert.deepEqual(local.reads, [PRIVACY_KEY]);
    assert.deepEqual(session.reads, []);
  }
});

test('cross-tab consent acceptance captures the current page referral', () => {
  const local = storage();
  const controller = createPrivacyController({ local, now: () => at, search: '?ref=other1' });
  assert.equal(controller.pendingReferral(), '');
  local.setItem(PRIVACY_KEY, choice(at));
  controller.refresh();
  assert.equal(controller.pendingReferral(), 'OTHER1');
  assert.equal(local.data.get('sineday_pending_affiliate_code_saved_at'), String(at));
});

test('acceptance persists the exact visible photo; withdrawal cannot repopulate optional storage', () => {
  const local = storage({ 'sb-auth-token': 'keep' }), session = storage();
  let select;
  const controller = createPrivacyController({ local, session, now: () => at,
    onChange() { select?.persistCurrentSelection(); },
  });
  const gated = target => ({
    getItem(key) { return controller.allowed('photos') ? target.getItem(key) : null; },
    setItem(key, value) { if (controller.allowed('photos')) target.setItem(key, value); },
  });
  const collection = { 1: [{ id: 'photo-a' }, { id: 'photo-b' }], 2: [{ id: 'photo-c' }] };
  const dependencies = { collection, version: 'test', localStorage: gated(local), sessionStorage: gated(session), now: () => at, canPersist: () => controller.allowed('photos') };
  select = createPhotoSelector(dependencies);
  const visible = select(1);
  assert.equal(visible.id, 'photo-a');
  assert.deepEqual(local.reads, [PRIVACY_KEY]);
  assert.deepEqual(session.reads, []);
  assert.deepEqual(local.writes, []);
  controller.save({ photos: true });
  assert.equal(JSON.parse(local.data.get(PHOTO_HISTORY_KEY)).indices[1], 0);
  assert.equal(JSON.parse(session.data.get(PHOTO_VISIT_KEY)).indices[1], 0);
  assert.equal(select(1), visible);
  controller.save({ photos: false });
  const writes = [local.writes.length, session.writes.length];
  const reads = [local.reads.length, session.reads.length];
  select.persistCurrentSelection(); select(1); select(2);
  assert.deepEqual([local.writes.length, session.writes.length], writes);
  assert.deepEqual([local.reads.length, session.reads.length], reads);
  assert.equal(local.data.has(PHOTO_HISTORY_KEY), false);
  assert.equal(session.data.has(PHOTO_VISIT_KEY), false);
  assert.equal(local.data.get('sb-auth-token'), 'keep');
  controller.save({ photos: true });
  assert.equal(select(1), visible);
  assert.deepEqual(JSON.parse(local.data.get(PHOTO_HISTORY_KEY)).indices, { 1: 0, 2: 0 });
  session.data.delete(PHOTO_VISIT_KEY);
  const laterVisit = createPhotoSelector(dependencies);
  assert.equal(laterVisit(1).id, 'photo-b');
});
