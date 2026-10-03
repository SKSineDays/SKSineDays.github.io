import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const login = readFileSync(new URL("../login.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("one dashboard invitation accompanies the existing homepage actions", () => {
  const intro = index.indexOf('id="wave-intro"');
  const invitation = index.indexOf('class="dashboard-invitation"', intro);
  const actions = index.indexOf('class="hero-action-row"', invitation);
  const note = index.indexOf('class="dashboard-invitation__note"', actions);
  const banner = index.indexOf('class="daily-email-banner"', note);
  assert.ok(intro >= 0 && invitation > intro && actions > invitation);
  assert.ok(note > actions && banner > note);
  assert.equal((index.match(/class="dashboard-invitation"/g) || []).length, 1);
  assert.match(index, /<h2>Welcome to your daily space\.<\/h2>/);
  assert.match(index, /Origin Duck and explore SineDay’s journal, memory calendar, and printable journal pages\./);
  assert.match(index, /<a href="\/login\.html" class="hero-btn hero-btn--secondary">Explore my dashboard<\/a>/);
  assert.match(index, /id="discover-more-btn"[^>]*>Discover More<\/button>/);
});

test("dashboard invitation discloses sign-in methods and Premium tools", () => {
  assert.match(index, /Sign in with Google or Apple\. Journal, History and Print require Premium\./);
  const invitation = index.slice(index.indexOf('class="dashboard-invitation"'), index.indexOf('class="daily-email-banner"'));
  assert.doesNotMatch(invitation, /free|planner/i);
});

test("existing result and reset flows relocate the same intro and invitation", () => {
  assert.match(ui, /anchor\.parentNode\.insertBefore\(this\.elements\.waveIntro, anchor\.nextSibling\)/);
  assert.match(ui, /this\.elements\.waveIntro\.classList\.add\('bottom-placement'\)/);
  assert.match(ui, /insertBefore\(\s*this\.elements\.waveIntro,\s*waveContainer\.nextSibling\s*\)/);
  assert.match(ui, /this\.elements\.waveIntro\.classList\.remove\('bottom-placement'\)/);
});

test("login welcomes new and returning users while retaining both providers", () => {
  assert.match(login, /<strong>Welcome to SineDay<\/strong>/);
  assert.match(login, /New here or returning\? Sign in with Google or Apple to open your dashboard\./);
  assert.doesNotMatch(login, /Welcome back|Sign in to continue your SineDay journal\./);
  for (const provider of ["google", "apple"]) {
    assert.match(login, new RegExp(`<button id="${provider}-signin-btn"[^>]*type="button"`));
  }
  assert.match(login, /id="login-status"[^>]*role="status"/);
  assert.match(login, /src="\/js\/login\.js"/);
});
