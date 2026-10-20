import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPhotoSelector,
  PHOTO_HISTORY_KEY,
  PHOTO_VISIT_IDLE_MS,
  PHOTO_VISIT_KEY,
} from '../js/day-photo-selection.js';

const VERSION = 'synthetic-approved-180-v1';
const START = 1_792_520_000_000;
const COLLECTION = Object.freeze(Object.fromEntries(
  Array.from({ length: 18 }, (_, dayIndex) => {
    const day = dayIndex + 1;
    return [day, Object.freeze(Array.from({ length: 10 }, (_, index) => Object.freeze({
      id: `day-${day}-photo-${index + 1}`,
      day,
      index,
      src: `/synthetic-approved/day-${day}/photo-${index + 1}.webp`,
      fallback: `/synthetic-approved/day-${day}/photo-${index + 1}.jpeg`,
      alt: `Synthetic approved nature photograph ${index + 1} for SineDay ${day}`,
    })))];
  }),
));

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { reads: [], writes: [] };
  return {
    data,
    calls,
    getItem(key) { calls.reads.push(key); return data.get(key) ?? null; },
    setItem(key, value) { calls.writes.push([key, value]); data.set(key, String(value)); },
    clear() { data.clear(); },
  };
}

function savedVisit(indices, lastUsed = START, version = VERSION) {
  return JSON.stringify({ version, lastUsed, indices });
}

function savedHistory(indices, version = VERSION) {
  return JSON.stringify({ version, indices });
}

function read(storageObject, key) {
  return JSON.parse(storageObject.data.get(key));
}

function setup(options = {}) {
  let time = START;
  const session = options.session ?? storage();
  const history = options.history ?? storage();
  const dependencies = {
    collection: COLLECTION,
    version: VERSION,
    sessionStorage: session,
    localStorage: history,
    now: () => time,
    ...options.dependencies,
  };
  return {
    session,
    history,
    select: createPhotoSelector(dependencies),
    newDocument: (overrides = {}) => createPhotoSelector({ ...dependencies, ...overrides }),
    setTime(value) { time = value; },
  };
}

test('synthetic fixture contains exactly eighteen complete ten-photo days', () => {
  assert.equal(Object.keys(COLLECTION).length, 18);
  assert.equal(new Set(Object.values(COLLECTION).flat().map(photo => photo.id)).size, 180);
  for (let day = 1; day <= 18; day++) {
    assert.equal(COLLECTION[day].length, 10);
    assert.ok(COLLECTION[day].every(photo => photo.day === day));
  }
  assert.equal(PHOTO_VISIT_IDLE_MS, 30 * 60 * 1000);
  assert.notEqual(PHOTO_VISIT_KEY, PHOTO_HISTORY_KEY);
});

test('first selection returns an unchanged manifest object for all eighteen days', () => {
  const { select, session, history } = setup();
  for (let day = 1; day <= 18; day++) assert.strictEqual(select(day), COLLECTION[day][0]);
  assert.deepEqual(read(session, PHOTO_VISIT_KEY).indices, Object.fromEntries(
    Array.from({ length: 18 }, (_, index) => [index + 1, 0]),
  ));
  assert.deepEqual(read(history, PHOTO_HISTORY_KEY).indices, read(session, PHOTO_VISIT_KEY).indices);
});

test('repeated renders and interleaved day selections never advance an already viewed day', () => {
  const { select, history } = setup();
  const first = select(1);
  for (let repeat = 0; repeat < 100; repeat++) {
    assert.strictEqual(select(1), first);
    assert.strictEqual(select(18), COLLECTION[18][0]);
    assert.strictEqual(select(1), first);
  }
  assert.equal(history.calls.writes.length, 2);
  assert.deepEqual(read(history, PHOTO_HISTORY_KEY).indices, { 1: 0, 18: 0 });
});

test('reloads and same-tab document navigation reuse every selected photo', () => {
  const harness = setup();
  for (let day = 1; day <= 18; day++) harness.select(day);
  for (let navigation = 0; navigation < 20; navigation++) {
    harness.setTime(START + navigation * 1000);
    const nextDocument = harness.newDocument();
    for (let day = 1; day <= 18; day++) assert.strictEqual(nextDocument(day), COLLECTION[day][0]);
  }
  assert.equal(harness.history.calls.writes.length, 18);
  assert.equal(read(harness.session, PHOTO_VISIT_KEY).lastUsed, START + 19_000);
});

test('a fresh module instance also reuses a persisted same-tab visit', async () => {
  const harness = setup();
  assert.strictEqual(harness.select(8), COLLECTION[8][0]);
  const freshModule = await import('../js/day-photo-selection.js?photo-selector-reload-test');
  const freshSelect = freshModule.createPhotoSelector({
    collection: COLLECTION, version: VERSION,
    sessionStorage: harness.session, localStorage: harness.history, now: () => START + 1000,
  });
  assert.strictEqual(freshSelect(8), COLLECTION[8][0]);
  assert.equal(harness.history.calls.writes.length, 1);
});

test('genuinely new tab sessions exhaust all ten photos before repeating, for every day', () => {
  const history = storage();
  const seen = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [index + 1, []]));
  for (let visit = 0; visit < 21; visit++) {
    const { select } = setup({ session: storage(), history });
    for (let day = 1; day <= 18; day++) {
      const photo = select(day);
      assert.strictEqual(photo, COLLECTION[day][visit % 10]);
      seen[day].push(photo.id);
      assert.strictEqual(select(day), photo);
    }
  }
  for (let day = 1; day <= 18; day++) {
    assert.equal(new Set(seen[day].slice(0, 10)).size, 10);
    assert.equal(new Set(seen[day].slice(10, 20)).size, 10);
    assert.equal(seen[day][20], seen[day][0]);
  }
});

test('each day advances only when actually viewed in a new visit', () => {
  const history = storage();
  for (let visit = 0; visit < 7; visit++) {
    const { select } = setup({ history });
    assert.strictEqual(select(12), COLLECTION[12][visit]);
    if (visit === 0 || visit === 6) assert.strictEqual(select(3), COLLECTION[3][visit === 0 ? 0 : 1]);
  }
  assert.deepEqual(read(history, PHOTO_HISTORY_KEY).indices, { 3: 1, 12: 6 });
  const next = setup({ history }).select;
  assert.strictEqual(next(1), COLLECTION[1][0]);
  assert.strictEqual(next(12), COLLECTION[12][7]);
  assert.strictEqual(next(3), COLLECTION[3][2]);
});

test('concurrent existing tabs keep their own visit selections while history advances', () => {
  const history = storage();
  const first = setup({ history });
  const second = setup({ history });
  assert.strictEqual(first.select(4), COLLECTION[4][0]);
  assert.strictEqual(second.select(4), COLLECTION[4][1]);
  assert.strictEqual(first.newDocument()(4), COLLECTION[4][0]);
  assert.strictEqual(second.newDocument()(4), COLLECTION[4][1]);
  assert.strictEqual(setup({ history }).select(4), COLLECTION[4][2]);
});

test('an existing document never rotates its displayed image after the idle interval', () => {
  const harness = setup();
  const photo = harness.select(1);
  for (const elapsed of [PHOTO_VISIT_IDLE_MS - 1, PHOTO_VISIT_IDLE_MS, PHOTO_VISIT_IDLE_MS + 1, 7 * 86400_000]) {
    harness.setTime(START + elapsed);
    assert.strictEqual(harness.select(1), photo);
  }
  assert.equal(harness.history.calls.writes.length, 1);
});

test('an existing document retains its original visit for newly rendered days after expiry', () => {
  const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 1: 3, 2: 7 }) });
  const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 1: 3, 2: 7 }) });
  const harness = setup({ session, history });
  assert.strictEqual(harness.select(1), COLLECTION[1][3]);
  harness.setTime(START + PHOTO_VISIT_IDLE_MS * 3);
  assert.strictEqual(harness.select(2), COLLECTION[2][7]);
  assert.strictEqual(harness.select(1), COLLECTION[1][3]);
  assert.equal(history.calls.writes.length, 0);
});

test('new documents expire a visit at precisely thirty minutes, not one millisecond earlier', async (t) => {
  for (const [age, expectedIndex] of [[0, 4], [PHOTO_VISIT_IDLE_MS - 1, 4], [PHOTO_VISIT_IDLE_MS, 5], [PHOTO_VISIT_IDLE_MS + 1, 5]]) {
    await t.test(`age ${age} ms selects index ${expectedIndex}`, () => {
      const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 5: 4 }) });
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 5: 4 }) });
      const harness = setup({ session, history });
      harness.setTime(START + age);
      assert.strictEqual(harness.select(5), COLLECTION[5][expectedIndex]);
      assert.equal(read(session, PHOTO_VISIT_KEY).lastUsed, START + age);
    });
  }
});

test('new-document activity renews the inactivity window without advancing the photo', () => {
  const harness = setup();
  harness.select(9);
  harness.setTime(START + PHOTO_VISIT_IDLE_MS - 1);
  assert.strictEqual(harness.newDocument()(9), COLLECTION[9][0]);
  harness.setTime(START + PHOTO_VISIT_IDLE_MS * 2 - 2);
  assert.strictEqual(harness.newDocument()(9), COLLECTION[9][0]);
  assert.equal(harness.history.calls.writes.length, 1);
});

test('same-document selection activity renews inactivity without changing the displayed photo', () => {
  const harness = setup();
  harness.select(9);
  harness.setTime(START + PHOTO_VISIT_IDLE_MS - 1);
  assert.strictEqual(harness.select(9), COLLECTION[9][0]);
  harness.setTime(START + PHOTO_VISIT_IDLE_MS + 1);
  assert.strictEqual(harness.newDocument()(9), COLLECTION[9][0],
    'A new document two milliseconds after selecting a photo is not a new inactive visit');
});

test('future stored timestamps invalidate visits while retaining valid per-day history', async (t) => {
  for (const futureOffset of [1, PHOTO_VISIT_IDLE_MS, 365 * 86400_000]) {
    await t.test(`future timestamp offset ${futureOffset}`, () => {
      const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 6: 8 }, START + futureOffset) });
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 6: 8 }) });
      const harness = setup({ session, history });
      assert.strictEqual(harness.select(6), COLLECTION[6][9]);
      assert.equal(read(session, PHOTO_VISIT_KEY).lastUsed, START);
    });
  }
});

test('clock changes never alter an image already selected in this document', () => {
  const harness = setup();
  const photo = harness.select(18);
  harness.setTime(START - 86400_000);
  assert.strictEqual(harness.select(18), photo);
  harness.setTime(START + 86400_000);
  assert.strictEqual(harness.select(18), photo);
});

test('invalid days return null without reading or writing storage', () => {
  const { select, session, history } = setup();
  for (const invalid of [undefined, null, true, false, 0, -1, 19, 1.5, NaN, Infinity, -Infinity, '1', '18', '', {}, [], 1n]) {
    assert.equal(select(invalid), null);
  }
  assert.deepEqual(session.calls, { reads: [], writes: [] });
  assert.deepEqual(history.calls, { reads: [], writes: [] });
});

test('missing, empty, or non-array day collections fail safely without advancing history', () => {
  const { select, session, history } = setup({ dependencies: { collection: { 1: [], 2: null, 3: {}, 4: 'invalid' } } });
  for (let day = 1; day <= 18; day++) assert.equal(select(day), null);
  assert.deepEqual(session.calls, { reads: [], writes: [] });
  assert.deepEqual(history.calls, { reads: [], writes: [] });
});

test('index bounds follow each manifest day length, including a one-photo fallback group', () => {
  const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 1: 0, 2: 2, 3: 9 }) });
  const collection = { 1: COLLECTION[1].slice(0, 1), 2: COLLECTION[2].slice(0, 3), 3: COLLECTION[3].slice(0, 3) };
  const { select } = setup({ history, dependencies: { collection } });
  assert.strictEqual(select(1), COLLECTION[1][0]);
  assert.strictEqual(select(2), COLLECTION[2][0]);
  assert.strictEqual(select(3), COLLECTION[3][0]);
});

const INVALID_INDICES = [-1, 10, 1000, 0.5, null, true, false, '0', '3', {}, [], undefined];

test('invalid session indices fall back to history without damaging other day selections', async (t) => {
  for (const [caseNumber, invalid] of INVALID_INDICES.entries()) {
    await t.test(`invalid session index case ${caseNumber}: ${String(invalid)}`, () => {
      const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 1: invalid, 2: 7 }) });
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 1: 3, 2: 7 }) });
      const { select } = setup({ session, history });
      assert.strictEqual(select(1), COLLECTION[1][4]);
      assert.strictEqual(select(2), COLLECTION[2][7]);
      assert.deepEqual(read(session, PHOTO_VISIT_KEY).indices, { 1: 4, 2: 7 });
    });
  }
});

test('invalid history indices restart only the affected day at its first approved photo', async (t) => {
  for (const [caseNumber, invalid] of INVALID_INDICES.entries()) {
    await t.test(`invalid history index case ${caseNumber}: ${String(invalid)}`, () => {
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 1: invalid, 2: 7 }) });
      const { select } = setup({ history });
      assert.strictEqual(select(1), COLLECTION[1][0]);
      assert.strictEqual(select(2), COLLECTION[2][8]);
      assert.deepEqual(read(history, PHOTO_HISTORY_KEY).indices, { 1: 0, 2: 8 });
    });
  }
});

test('valid session selections take precedence over newer or damaged global history', () => {
  for (const historyValue of [savedHistory({ 11: 8 }), '{broken', savedHistory({ 11: 'bad' })]) {
    const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 11: 2 }) });
    const history = storage({ [PHOTO_HISTORY_KEY]: historyValue });
    assert.strictEqual(setup({ session, history }).select(11), COLLECTION[11][2]);
    assert.equal(history.calls.reads.length, 0);
    assert.equal(history.calls.writes.length, 0);
  }
});

test('mismatched or missing visit versions invalidate only the visit', async (t) => {
  for (const version of ['old-version', '', 1, null, undefined]) {
    await t.test(`visit version ${String(version)}`, () => {
      const session = storage({ [PHOTO_VISIT_KEY]: JSON.stringify({ version, lastUsed: START, indices: { 7: 5 } }) });
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 7: 5 }) });
      assert.strictEqual(setup({ session, history }).select(7), COLLECTION[7][6]);
      assert.equal(read(session, PHOTO_VISIT_KEY).version, VERSION);
    });
  }
});

test('mismatched or missing history versions restart the collection safely', async (t) => {
  for (const version of ['old-version', '', 1, null, undefined]) {
    await t.test(`history version ${String(version)}`, () => {
      const history = storage({ [PHOTO_HISTORY_KEY]: JSON.stringify({ version, indices: { 7: 5 } }) });
      const harness = setup({ history });
      assert.strictEqual(harness.select(7), COLLECTION[7][0]);
      assert.equal(read(history, PHOTO_HISTORY_KEY).version, VERSION);
    });
  }
});

test('changing the manifest version invalidates old visit and history indices together', () => {
  const session = storage({ [PHOTO_VISIT_KEY]: savedVisit({ 4: 7 }) });
  const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 4: 7 }) });
  const { select } = setup({ session, history, dependencies: { version: `${VERSION}-replacement` } });
  assert.strictEqual(select(4), COLLECTION[4][0]);
  assert.equal(read(session, PHOTO_VISIT_KEY).version, `${VERSION}-replacement`);
  assert.equal(read(history, PHOTO_HISTORY_KEY).version, `${VERSION}-replacement`);
});

test('malformed visit JSON and invalid visit shapes recover through valid history', async (t) => {
  const values = ['', 'not json', '{', 'null', 'true', '42', '[]', '"text"', '{}',
    ...[null, [], 12, 'invalid', false].map(indices => savedVisit(indices)),
    JSON.stringify({ version: VERSION, indices: { 10: 2 } }),
    savedVisit({ 10: 2 }, 'not-a-time'),
    savedVisit({ 10: 2 }, null),
  ];
  for (const [caseNumber, value] of values.entries()) {
    await t.test(`corrupt visit case ${caseNumber}`, () => {
      const session = storage({ [PHOTO_VISIT_KEY]: value });
      const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 10: 2 }) });
      assert.strictEqual(setup({ session, history }).select(10), COLLECTION[10][3]);
    });
  }
});

test('malformed history JSON and invalid history shapes recover to first approved photo', async (t) => {
  const values = ['', 'not json', '{', 'null', 'true', '42', '[]', '"text"', '{}',
    ...[null, [], 12, 'invalid', false].map(indices => savedHistory(indices)),
  ];
  for (const [caseNumber, value] of values.entries()) {
    await t.test(`corrupt history case ${caseNumber}`, () => {
      const history = storage({ [PHOTO_HISTORY_KEY]: value });
      assert.strictEqual(setup({ history }).select(10), COLLECTION[10][0]);
    });
  }
});

test('absent storage preserves a safe and stable in-memory selection', async (t) => {
  for (const unavailable of [undefined, null, {}]) {
    await t.test(`storage ${String(unavailable)}`, () => {
      const { select } = setup({ dependencies: { sessionStorage: unavailable, localStorage: unavailable } });
      for (let day = 1; day <= 18; day++) {
        assert.strictEqual(select(day), COLLECTION[day][0]);
        assert.strictEqual(select(day), COLLECTION[day][0]);
      }
    });
  }
});

test('privacy-mode storage failures and throwing method getters never prevent selection', () => {
  const blocked = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
  };
  const blockedGetters = {
    get getItem() { throw new Error('SecurityError'); },
    get setItem() { throw new Error('SecurityError'); },
  };
  for (const unavailable of [blocked, blockedGetters]) {
    const { select } = setup({ dependencies: { sessionStorage: unavailable, localStorage: unavailable } });
    for (let day = 1; day <= 18; day++) {
      assert.strictEqual(select(day), COLLECTION[day][0]);
      assert.strictEqual(select(day), COLLECTION[day][0]);
    }
  }
});

test('unavailable session storage still permits new-document advancement through history', () => {
  const harness = setup({ dependencies: { sessionStorage: null } });
  assert.strictEqual(harness.select(16), COLLECTION[16][0]);
  assert.strictEqual(harness.select(16), COLLECTION[16][0]);
  assert.strictEqual(harness.newDocument()(16), COLLECTION[16][1]);
});

test('unavailable history storage preserves same-tab selections but cannot promise cross-tab rotation', () => {
  const harness = setup({ dependencies: { localStorage: null } });
  assert.strictEqual(harness.select(16), COLLECTION[16][0]);
  assert.strictEqual(harness.newDocument()(16), COLLECTION[16][0]);
  assert.strictEqual(harness.newDocument({ sessionStorage: storage() })(16), COLLECTION[16][0]);
});

test('quota-full stores retain available history and never interrupt current-document selection', () => {
  const session = storage();
  const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 13: 4 }) });
  session.setItem = history.setItem = () => { throw new Error('QuotaExceededError'); };
  const { select } = setup({ session, history });
  assert.strictEqual(select(13), COLLECTION[13][5]);
  assert.strictEqual(select(13), COLLECTION[13][5]);
  assert.strictEqual(select(14), COLLECTION[14][0]);
  assert.strictEqual(select(13), COLLECTION[13][5]);
  assert.deepEqual(read(history, PHOTO_HISTORY_KEY).indices, { 13: 4 });
});

test('quota-full history still allows same-tab persistence through working session storage', () => {
  const history = storage({ [PHOTO_HISTORY_KEY]: savedHistory({ 13: 4 }) });
  history.setItem = () => { throw new Error('QuotaExceededError'); };
  const harness = setup({ history });
  assert.strictEqual(harness.select(13), COLLECTION[13][5]);
  assert.strictEqual(harness.newDocument()(13), COLLECTION[13][5]);
  assert.deepEqual(read(harness.session, PHOTO_VISIT_KEY).indices, { 13: 5 });
});

test('clearing or changing browser storage cannot change a photo already shown in this document', () => {
  const harness = setup();
  const first = harness.select(1);
  harness.session.clear();
  harness.history.data.set(PHOTO_HISTORY_KEY, savedHistory({ 1: 8 }));
  assert.strictEqual(harness.select(1), first);
  // The active document may persist its stable visit again while recording
  // activity. Clear that newly written visit to represent a fresh document.
  harness.session.clear();
  assert.strictEqual(harness.newDocument()(1), COLLECTION[1][9]);
  assert.strictEqual(harness.select(1), first);
});

test('persisted state contains only version, timing, and numeric photo indices', () => {
  const { select, session, history } = setup();
  select(1);
  select(18);
  const visit = read(session, PHOTO_VISIT_KEY);
  const saved = read(history, PHOTO_HISTORY_KEY);
  assert.deepEqual(Object.keys(visit).sort(), ['indices', 'lastUsed', 'version']);
  assert.deepEqual(Object.keys(saved).sort(), ['indices', 'version']);
  for (const record of [visit, saved]) {
    assert.deepEqual(record.indices, { 1: 0, 18: 0 });
    assert.ok(Object.values(record.indices).every(Number.isInteger));
    assert.doesNotMatch(JSON.stringify(record), /synthetic-approved\/|photo-1|birthdate|journal|email|account/i);
  }
  assert.deepEqual([...session.data.keys()], [PHOTO_VISIT_KEY]);
  assert.deepEqual([...history.data.keys()], [PHOTO_HISTORY_KEY]);
});
