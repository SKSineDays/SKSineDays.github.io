/**
 * Release-only selected-use registration, NOT visitor analytics.
 * Default is a dry run. No credential is read until --execute is supplied.
 * Keep one durable private ledger across batches. Never commit that ledger.
 */
import { readFile, writeFile, rename, open, mkdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (args.includes('--help')) {
  console.log('Dry run: node scripts/register-day-photo-use.mjs [--ledger /private/persistent/website-photo-use.json]');
  console.log('After release approval only: UNSPLASH_ACCESS_KEY=<secure environment> node scripts/register-day-photo-use.mjs --execute --ledger /private/persistent/website-photo-use.json --available-requests <verified remaining, 0..50> --max-events <1..35>');
  process.exit(0);
}
const source = JSON.parse(await readFile(new URL('../docs/art-direction/day-photo-provenance.json', import.meta.url)));
const selectionBytes = await readFile(new URL('../docs/art-direction/day-photo-selection.json', import.meta.url));
assert.equal(createHash('sha256').update(selectionBytes).digest('hex'), source.selectionSha256);
const selection = JSON.parse(selectionBytes);
const photos = source.days.flatMap(group => {
  assert.deepEqual(group.photos.map(photo => photo.id), selection[group.day]);
  return group.photos;
});
assert.equal(photos.length, 180);
assert.equal(new Set(photos.map(photo => photo.id)).size, 180);
for (const photo of photos) {
  const endpoint = new URL(photo.downloadLocation);
  assert.equal(endpoint.origin, 'https://api.unsplash.com');
  assert.equal(endpoint.pathname, `/photos/${photo.id}/download`);
  assert.ok(endpoint.searchParams.get('ixid'));
  assert.ok(!endpoint.searchParams.has('client_id'));
}
const ledgerArg = value('--ledger');
const ledgerPath = ledgerArg ? resolve(ledgerArg) : null;
const newLedger = () => ({ schema: 1, purpose: 'SineDay website day-photo installation', selectionSha256: source.selectionSha256, events: {} });
async function readLedger() {
  if (!ledgerPath) return newLedger();
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.schema, 1);
    assert.equal(ledger.purpose, 'SineDay website day-photo installation');
    assert.equal(ledger.selectionSha256, source.selectionSha256);
    assert.ok(ledger.events && typeof ledger.events === 'object' && !Array.isArray(ledger.events));
    for (const [id, event] of Object.entries(ledger.events)) {
      assert.ok(photos.some(photo => photo.id === id));
      assert.ok(['recorded', 'in-flight', 'uncertain', 'rejected'].includes(event.status));
    }
    return ledger;
  } catch (error) {
    if (error.code === 'ENOENT') return newLedger();
    throw error;
  }
}
function summary(ledger) {
  const recorded = photos.filter(photo => ledger.events[photo.id]?.status === 'recorded').length;
  const unresolved = photos.filter(photo => ['in-flight', 'uncertain', 'rejected'].includes(ledger.events[photo.id]?.status)).map(photo => photo.id);
  return { total: photos.length, recorded, pending: photos.length - recorded, unresolved, complete: recorded === photos.length };
}
let ledger = await readLedger();
if (!args.includes('--execute')) {
  console.log(JSON.stringify({ mode: 'dry-run; no requests made', ...summary(ledger) }, null, 2));
  process.exit(0);
}
assert.ok(ledgerPath, '--execute requires the same durable private --ledger for every batch');
const remainingAtStart = Number(value('--available-requests'));
const maxEvents = Number(value('--max-events'));
assert.ok(Number.isInteger(remainingAtStart) && remainingAtStart >= 0 && remainingAtStart <= 50,
  'Supply verified current remaining requests (0..50); never guess or reset the quota');
assert.ok(Number.isInteger(maxEvents) && maxEvents >= 1 && maxEvents <= 35, '--max-events must be 1..35');
const key = process.env.UNSPLASH_ACCESS_KEY;
assert.ok(key, 'Use the existing secure Unsplash key in the execution environment. Do not paste or commit it.');
await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 });
const lockPath = ledgerPath + '.lock';
const lock = await open(lockPath, 'wx', 0o600).catch(error => {
  if (error.code === 'EEXIST') throw new Error('Ledger is locked. Check the prior batch outcome before any retry; never delete a live or unexplained lock.');
  throw error;
});
async function save() {
  const temporary = ledgerPath + '.pending';
  await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, ledgerPath);
}
try {
  // Reload after acquiring the lock, so another completed batch cannot be duplicated.
  ledger = await readLedger();
  assert.equal(summary(ledger).unresolved.length, 0, 'Prior uncertain/rejected/in-flight events need investigation before continuing. Never blindly retry them.');
  let remaining = remainingAtStart;
  let sent = 0;
  for (const photo of photos) {
    if (ledger.events[photo.id]?.status === 'recorded') continue;
    if (sent >= maxEvents || remaining <= 15) break;
    // Persist before transmitting: a crash is explicitly uncertain, never a fresh event.
    ledger.events[photo.id] = { status: 'in-flight', attemptedAt: new Date().toISOString() };
    await save();
    try {
      const response = await fetch(photo.downloadLocation, {
        method: 'GET', redirect: 'error',
        headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
        signal: AbortSignal.timeout(20_000),
      });
      sent++;
      remaining--;
      const header = response.headers.get('x-ratelimit-remaining');
      if (header !== null && /^\d+$/.test(header)) remaining = Math.min(remaining, Number(header));
      const event = ledger.events[photo.id];
      event.httpStatus = response.status;
      event.remainingRequests = remaining;
      event.finishedAt = new Date().toISOString();
      // Do not retain the response body, signed URLs, headers, or any credential.
      await response.body?.cancel();
      if (response.ok) {
        event.status = 'recorded';
        await save();
        console.log(JSON.stringify({ id: photo.id, status: 'recorded', remainingRequests: remaining }));
      } else {
        event.status = response.status >= 500 ? 'uncertain' : 'rejected';
        await save();
        throw new Error(`Registration stopped for ${photo.id}: HTTP ${response.status}. Inspect the ledger before any further attempt.`);
      }
    } catch (error) {
      if (ledger.events[photo.id].status === 'in-flight') {
        ledger.events[photo.id].status = 'uncertain';
        ledger.events[photo.id].finishedAt = new Date().toISOString();
        await save();
      }
      // The underlying error may contain request data; report only the bounded outcome.
      throw new Error(`Batch stopped at ${photo.id}; status ${ledger.events[photo.id].status}. Check the durable ledger and verified provider outcome. No automatic retry.`, { cause: undefined });
    }
  }
  console.log(JSON.stringify({ mode: 'executed bounded batch', sent, remainingRequests: remaining, ...summary(ledger) }, null, 2));
} finally {
  await lock.close();
  await unlink(lockPath);
}
