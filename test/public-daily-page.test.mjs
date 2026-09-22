import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const daily = readFileSync(new URL("../daily.html", import.meta.url), "utf8");
const confirm = readFileSync(new URL("../daily-confirm.html", import.meta.url), "utf8");
const signupJs = readFileSync(new URL("../js/daily-signup.js", import.meta.url), "utf8");
const confirmJs = readFileSync(new URL("../js/daily-confirm.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("public signup page contains the required copy, fields, consent, and one form", () => {
  for (const copy of [
    "Your SineDay, in your inbox.",
    "Meet today's SineDuck, explore the day's theme, and take a quiet moment for your own thoughts.",
    "A personal morning ritual, around 6:00 AM in your chosen time zone.",
    "Free daily emails. No account required.",
    "Send me my daily SineDay",
    "Yes, send me my daily SineDay emails. I can unsubscribe anytime.",
    "We use your birthdate to calculate your SineDay rhythm. This email-only signup stores the derived rhythm values needed for your daily emails, not your full birthdate."
  ]) {
    assert.ok(daily.includes(copy), copy);
  }
  assert.equal((daily.match(/<form\b/g) || []).length, 1);
  assert.match(daily, /type="email"/);
  assert.match(daily, /type="date"/);
  assert.match(daily, /name="timezone"/);
  assert.match(daily, /name="consent"[\s\S]*type="checkbox"/);
  assert.doesNotMatch(daily, /name="consent"[^>]*\bchecked\b/);
  assert.match(daily, /assets\/sineducks\/SineDuck17\.svg/);
  assert.match(daily, /privacy\.html/);
  assert.match(daily, /contact\.html/);
});

test("signup page uses only its dedicated module and never stores birthdate", () => {
  assert.match(daily, /src="\/js\/daily-signup\.js"/);
  assert.doesNotMatch(daily, /js\/(?:ui|dashboard)\.js/);
  assert.doesNotMatch(signupJs, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(signupJs, /birthdate.*(?:searchParams|location)/i);
  assert.match(signupJs, /birthdateInput\.value = ""/);
  assert.match(signupJs, /source[\s\S]*homepage-banner/);
});

test("confirmation page is explicit, tracker-free, noindex, and fragment-based", () => {
  assert.match(confirm, /Confirm my daily emails/);
  assert.match(confirm, /noindex, nofollow, noarchive/);
  assert.match(confirm, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(confirm, /vercel-analytics|_vercel\/insights/i);
  assert.match(confirmJs, /window\.location\.hash/);
  assert.match(confirmJs, /history\.replaceState/);
  assert.match(confirmJs, /addEventListener\("click"/);
  assert.match(confirmJs, /method: "POST"/);
  const clickPosition = confirmJs.indexOf('addEventListener("click"');
  const fetchPosition = confirmJs.indexOf('fetch("/api/mailer-confirm"');
  assert.ok(clickPosition >= 0 && fetchPosition > clickPosition);
});

test("homepage banner stays inside wave intro after the hero actions", () => {
  const introStart = index.indexOf('id="wave-intro"');
  const heroActions = index.indexOf('class="hero-action-row"', introStart);
  const banner = index.indexOf('class="daily-email-banner"', heroActions);
  const introEnd = index.indexOf("</section>", banner);
  assert.ok(introStart >= 0 && heroActions > introStart && banner > heroActions);
  assert.ok(introEnd > banner);
  assert.match(index, /Let SineDay meet you each morning\./);
  assert.match(index, /href="\/daily\?source=homepage-banner"/);
});

test("Vercel keeps cron and vCard behavior while adding targeted daily rewrites", () => {
  assert.deepEqual(
    vercel.rewrites,
    [
      { source: "/daily", destination: "/daily.html" },
      { source: "/daily/confirm", destination: "/daily-confirm.html" }
    ]
  );
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/daily-email", schedule: "* * * * *" }
  ]);
  const vcard = vercel.headers.find(
    (entry) => entry.source === "/assets/email/sineday-daily.vcf"
  );
  assert.ok(vcard);
  assert.match(JSON.stringify(vcard), /text\/vcard/);
});

test("service worker bypasses APIs and never caches confirmation visits", () => {
  assert.match(serviceWorker, /CACHE_NAME = 'sineday-v24'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /url\.pathname === '\/daily\/confirm'/);
  assert.match(serviceWorker, /url\.pathname === '\/daily-confirm\.html'/);
  assert.match(serviceWorker, /fetch\(request, \{ cache: 'no-store' \}\)/);
});
