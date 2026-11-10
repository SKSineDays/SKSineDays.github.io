import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const ui = read("../js/ui.js");
const sw = read("../service-worker.js");

test("the SineDay story is an explicit video choice, not the retired scroll show", () => {
  assert.match(html, /href="\/assets\/video\/sineday-story-2026-11-10\.mp4"[^>]*data-home-video/);
  assert.match(html, /data-video-title="The SineDay story"/);
  assert.match(html, /data-video-transcript="\/video-transcripts\.html#story"/);
  assert.match(html, /src="\/assets\/video\/sineday-story-card\.jpg"[^>]*decoding="async"/);
  assert.doesNotMatch(html, /id="discover-story"|discover-story-scroller|data-sineduck-phrase/);
  assert.doesNotMatch(ui, /import[^;]*sineduck-intro-animation|new SineDuckIntroAnimation/);
  assert.doesNotMatch(html, /src="[^\"]*sineduck-intro-animation/);
  assert.ok(existsSync(new URL("../js/sineduck-intro-animation.js", import.meta.url)), "original animation remains archived");
});

test("linked story text retains the meaning and explains the silent visuals", () => {
  const transcript = read("../video-transcripts.html");
  assert.match(transcript, /id="story"/);
  for (const phrase of ["Alignment", "SineDuck", "18-day", "perspective", "wave"]) {
    assert.ok(transcript.includes(phrase), `story text retains ${phrase}`);
  }
  assert.match(transcript, /silent/i);
  assert.match(transcript, /visual|appears|animated/i);
});

test("homepage cache advances for the controller change without preloading video or retired animation", () => {
  assert.match(sw, /CACHE_NAME = 'sineday-v42'/);
  const assets = sw.slice(sw.indexOf('const ASSETS_TO_CACHE'), sw.indexOf('const OPTIONAL_ASSETS'));
  assert.match(assets, /'\/styles\.css'/);
  assert.match(assets, /'\/js\/ui\.js'/);
  assert.match(assets, /'\/js\/home-video\.js'/);
  assert.doesNotMatch(assets, /sineduck-intro-animation\.js|intro-video\.js|\.mp4/);
});
