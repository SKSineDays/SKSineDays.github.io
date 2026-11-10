import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
test('intro is opt-in, inline, accessible and transcript-equipped', () => {
  assert.match(html, /id="watch-sineday"/);
  const video = html.match(/<video\b[^>]*>/)[0];
  assert.match(video, /controls playsinline preload="none"/);
  assert.doesNotMatch(video, /autoplay/);
  assert.match(html, /id="intro-video-transcript"/);
  assert.match(html, /Share paper pages with your family/);
});
test('video bypasses service worker cache, including byte ranges', () => {
  const handlers = {};
  vm.runInNewContext(sw, { self: { addEventListener: (n,fn) => handlers[n]=fn }, location: { origin:'https://www.sineday.app' }, URL, console });
  for (const destination of ['video', '']) {
    let intercepted = false;
    handlers.fetch({ request: { method:'GET', url:'https://www.sineday.app/assets/video/sineday-intro-2026-11-09.mp4', destination, headers: new Headers({ Range:'bytes=0-1023' }) }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false);
  }
  assert.doesNotMatch(sw.slice(sw.indexOf('const ASSETS_TO_CACHE'), sw.indexOf('const OPTIONAL_ASSETS')), /assets\/video/);
});
test('closing panel and navigating away pause playback', () => {
  const handlers = {}, windowHandlers = {}; let pauses=0;
  const panel = { open:true, querySelector:()=>({pause:()=>pauses++}), addEventListener:(n,fn)=>handlers[n]=fn };
  vm.runInNewContext(readFileSync(new URL('../js/intro-video.js',import.meta.url),'utf8'), { document:{querySelectorAll:()=>[panel]}, window:{addEventListener:(n,fn)=>windowHandlers[n]=fn} });
  handlers.toggle(); assert.equal(pauses,0);
  panel.open=false; handlers.toggle(); assert.equal(pauses,1);
  windowHandlers.pagehide(); assert.equal(pauses,2);
});
