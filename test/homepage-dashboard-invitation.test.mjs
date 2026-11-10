import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const login = readFileSync(new URL("../login.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("one concise dashboard invitation precedes two films and the separate daily email card", () => {
  const intro = index.indexOf('id="wave-intro"');
  const invitation = index.indexOf('class="dashboard-invitation"', intro);
  const actions = index.indexOf('class="hero-action-row"', invitation);
  const note = index.indexOf('class="dashboard-invitation__note"', actions);
  const films = index.indexOf('id="watch-sineday"', note);
  const daily = index.indexOf('class="home-daily"', films);
  assert.ok(intro >= 0 && invitation > intro && actions > invitation);
  assert.ok(note > actions && films > note && daily > films);
  assert.equal((index.match(/class="dashboard-invitation"/g) || []).length, 1);
  assert.match(index, /<h1>A journal<br>with character\.<\/h1>/);
  assert.match(index, /<a href="\/login\.html"[^>]*>Open my dashboard/);
  assert.match(index, /<a[^>]*href="#input-container"[^>]*>Find my wave<\/a>/);
  assert.doesNotMatch(index, /id="discover-more-btn"|id="discover-story"/);
  assert.match(index, /href="\/daily\?source=homepage-banner"/);
});

test("dashboard invitation labels Premium tools separately from the free daily email", () => {
  const invitation = index.slice(index.indexOf('class="dashboard-invitation"'), index.indexOf('id="watch-sineday"'));
  assert.match(invitation, /Journal, History and Print are part of Premium\./);
  assert.doesNotMatch(invitation, /free|planner/i);
  const daily = index.slice(index.indexOf('class="home-daily"'), index.indexOf('id="input-container"'));
  assert.match(daily, /Free · No account needed/);
});

test("existing result and reset flows relocate the same intro and invitation", () => {
  assert.match(ui, /anchor\.parentNode\.insertBefore\(this\.elements\.waveIntro, anchor\.nextSibling\)/);
  assert.match(ui, /this\.elements\.waveIntro\.classList\.add\('bottom-placement'\)/);
  assert.match(ui, /insertBefore\(\s*this\.elements\.waveIntro,\s*waveContainer\.nextSibling\s*\)/);
  assert.match(ui, /this\.elements\.waveIntro\.classList\.remove\('bottom-placement'\)/);
});

test("login welcomes new and returning users while retaining both providers", () => {
  assert.match(login, /<strong>Welcome to SineDay<\/strong>/);
  assert.match(login, /New here or returning\? Sign in with Google, Apple, or email to open your dashboard\./);
  assert.doesNotMatch(login, /Welcome back|Sign in to continue your SineDay journal\./);
  for (const provider of ["google", "apple"]) {
    assert.match(login, new RegExp(`<button id="${provider}-signin-btn"[^>]*type="button"`));
  }
  assert.match(login, /id="login-status"[^>]*role="status"/);
  assert.match(login, /src="\/js\/login\.js"/);
});


test("homepage presents the original hero art once as a full-bleed readable introduction", () => {
  assert.doesNotMatch(index, /class="home-hero__art"/);
  assert.match(index, /class="home-hero__content"/);
  const css = readFileSync(new URL("../css/homepage.css", import.meta.url), "utf8");
  assert.match(css, /background-image:\s*url\('\/assets\/og-hero\.png'\)/);
  assert.match(css, /background-size:\s*cover/);
  assert.match(css, /\.home-hero\s*\{[^}]*min-height:[^}]*display:\s*flex/s);
  assert.match(ui, /IntersectionObserver/);
  assert.match(ui, /addEventListener\('scroll', this\._onHeroDepthScroll, \{ passive: true \}\)/);
  assert.match(ui, /this\._heroMotionQuery\.matches/);
});
