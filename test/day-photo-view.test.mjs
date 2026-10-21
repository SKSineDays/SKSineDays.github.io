import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAY_PHOTOS } from '../js/day-photo-collection.js';
import { photoImageUrl, photoSrcSet, presentDayPhoto, renderPhotoCredit, cancelDayPhoto } from '../js/day-photo-view.js';

function creditFixture() {
  return {
    children: [], hidden: false,
    ownerDocument: { createElement: () => ({}) },
    replaceChildren() { this.children = []; },
    append(...values) { this.children.push(...values); },
  };
}
function imageFixture() {
  return { style: {}, dataset: {}, naturalWidth: 800, currentSrc: '', src: '', srcset: '',
    removeAttribute(name) { delete this[name]; }, async decode() {},
  };
}
const result = { day: 1, imageAvifUrl: 'Day1.avif?v=20260910', imageUrl: 'Day1.jpeg?v=20260910', imageAlt: 'Original local artwork' };

test('all responsive variants retain Unsplash hotlink and complete ixid', () => {
  for (const photos of Object.values(DAY_PHOTOS)) for (const photo of photos) {
    const original = new URL(photo.url);
    assert.equal(original.hostname, 'images.unsplash.com');
    assert.ok(original.searchParams.get('ixid'));
    for (const width of [480, 768, 960, 1440]) {
      const resized = new URL(photoImageUrl(photo, width));
      assert.equal(resized.hostname, original.hostname);
      assert.equal(resized.pathname, original.pathname);
      assert.equal(resized.searchParams.get('ixid'), original.searchParams.get('ixid'));
      assert.equal(resized.searchParams.get('w'), String(width));
    }
    assert.equal(photoSrcSet(photo).split(', ').length, 4);
  }
});

test('credits use text nodes and safe linked photographer and Unsplash attribution', () => {
  const credit = creditFixture();
  const photo = DAY_PHOTOS[1][0];
  renderPhotoCredit(credit, photo);
  assert.equal(credit.hidden, false);
  assert.deepEqual(credit.children.filter(x => typeof x === 'string'), ['Photo by ', ' on ']);
  assert.equal(credit.children[1].textContent, photo.photographer);
  assert.equal(credit.children[1].href, photo.photographerUrl);
  assert.equal(credit.children[3].textContent, 'Unsplash');
  assert.equal(credit.children[3].href, photo.photoUrl);
  assert.equal(credit.children[1].rel, 'noopener noreferrer');
  renderPhotoCredit(credit, null);
  assert.equal(credit.hidden, true);
  assert.deepEqual(credit.children, []);
});

test('only selected photo loads, with accurate alt and credit after decode', async () => {
  const image = imageFixture(), credit = creditFixture();
  let loaded;
  presentDayPhoto({ image, credit, result, onLoad: url => { loaded = url; } });
  assert.equal(image.dataset.photoId, DAY_PHOTOS[1][0].id);
  assert.equal(image.alt, DAY_PHOTOS[1][0].alt);
  assert.equal(credit.hidden, true);
  image.currentSrc = photoImageUrl(DAY_PHOTOS[1][0], 480);
  await image.onload();
  assert.equal(image.style.opacity, '1');
  assert.equal(loaded, image.currentSrc);
  assert.equal(credit.hidden, false);
});

test('finite fallback chain clears photo sources and inaccurate credits', async () => {
  const image = imageFixture(), credit = creditFixture();
  let unavailable = 0;
  presentDayPhoto({ image, credit, result, onUnavailable: () => unavailable++ });
  image.onerror();
  assert.equal(image.src, '/Day1.avif?v=20260910');
  assert.equal(image.srcset, undefined);
  assert.equal(image.dataset.photoId, undefined);
  assert.equal(image.alt, result.imageAlt);
  await image.onload();
  assert.equal(credit.hidden, true);
  image.onerror();
  assert.equal(image.src, '/Day1.jpeg?v=20260910');
  image.onerror();
  assert.equal(unavailable, 1);
  assert.equal(image.style.opacity, '0');
  assert.equal(credit.hidden, true);
});

test('late decode from a superseded render cannot update image, credits or backdrop', async () => {
  const image = imageFixture(), credit = creditFixture();
  let release;
  image.decode = () => new Promise(resolve => { release = resolve; });
  let oldCalls = 0, newCalls = 0;
  presentDayPhoto({ image, credit, result, onLoad: () => oldCalls++ });
  const oldLoad = image.onload();
  presentDayPhoto({ image, credit, result: { ...result, day: 2 }, onLoad: () => newCalls++ });
  release();
  await oldLoad;
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 0);
  assert.equal(credit.hidden, true);
  assert.equal(image.dataset.photoId, DAY_PHOTOS[2][0].id);
  image.decode = async () => {};
  await image.onload();
  assert.equal(newCalls, 1);
});

test('a late selected-photo decode cannot overwrite its fallback credit state', async () => {
  const image = imageFixture(), credit = creditFixture();
  let release;
  image.decode = () => new Promise(resolve => { release = resolve; });
  let called = 0;
  presentDayPhoto({ image, credit, result, onLoad: () => called++ });
  const oldLoad = image.onload();
  image.onerror();
  release();
  await oldLoad;
  assert.equal(called, 0);
  assert.equal(credit.hidden, true);
  assert.equal(image.src, '/Day1.avif?v=20260910');
});

test('photo rotation stays outside rhythm/email logic and never tracks views as downloads', async () => {
  for (const file of ['js/sineday-engine.js', 'api/_lib/email-rhythm.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /day-photo/);
  }
  const view = await readFile(new URL('../js/day-photo-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, /api\.unsplash\.com|client_id|access_key|setInterval|new Image\(/);
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /url\.origin !== location\.origin/);
  assert.doesNotMatch(worker, /images\.unsplash\.com/);
  for (const module of ['collection', 'selection', 'view']) assert.ok(worker.includes(`/js/day-photo-${module}.js`));
});


test('reset cancels pending decodes and removes invisible credit links', async () => {
  const image = imageFixture(), credit = creditFixture();
  let release;
  image.decode = () => new Promise(resolve => { release = resolve; });
  let called = 0;
  presentDayPhoto({ image, credit, result, onLoad: () => called++ });
  const pending = image.onload();
  cancelDayPhoto(image, credit);
  release();
  await pending;
  assert.equal(called, 0);
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  assert.equal(credit.hidden, true);
  assert.deepEqual(credit.children, []);
});


test('same-photo rerenders preserve loaded presentation without rewriting sources or hiding credit', async () => {
  const image = imageFixture(), credit = creditFixture();
  presentDayPhoto({ image, credit, result });
  await image.onload();
  let rewrites = 0;
  for (const property of ['src', 'srcset']) {
    const value = image[property];
    Object.defineProperty(image, property, { get: () => value, set: () => { rewrites++; }, configurable: true });
  }
  let received;
  presentDayPhoto({ image, credit, result: { ...result }, onLoad: url => { received = url; } });
  assert.equal(rewrites, 0);
  assert.equal(image.style.opacity, '1');
  assert.equal(credit.hidden, false);
  assert.equal(received, image.src);
});

test('same-photo pending rerender gives the eventual load to the newest callback', async () => {
  const image = imageFixture(), credit = creditFixture();
  let release;
  image.decode = () => new Promise(resolve => { release = resolve; });
  let oldCalls = 0, newCalls = 0;
  presentDayPhoto({ image, credit, result, onLoad: () => oldCalls++ });
  const pending = image.onload();
  presentDayPhoto({ image, credit, result: { ...result }, onLoad: () => newCalls++ });
  release();
  await pending;
  assert.equal(oldCalls, 0);
  assert.equal(newCalls, 1);
  assert.equal(credit.hidden, false);
});


test('a later responsive-load failure cannot resurrect a previous successful URL on rerender', async () => {
  const image = imageFixture(), credit = creditFixture();
  presentDayPhoto({ image, credit, result });
  await image.onload();
  image.onerror();
  assert.equal(credit.hidden, true);
  assert.equal(image.style.opacity, '0');
  image.onerror();
  image.onerror();
  let loaded = 0, unavailable = 0;
  presentDayPhoto({ image, credit, result: { ...result }, onLoad: () => loaded++, onUnavailable: () => unavailable++ });
  assert.equal(loaded, 0);
  assert.equal(unavailable, 1);
});
