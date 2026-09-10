import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const analyticsJs = readFileSync(join(root, "js/vercel-analytics.js"), "utf8");
const serviceWorker = readFileSync(join(root, "service-worker.js"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const publicHtmlFiles = [
  "index.html",
  "dashboard.html",
  "login.html",
  "contact.html",
  "privacy.html",
  "terms.html",
  "refunds.html",
  "accessibility.html",
  "affiliate.html",
  "affiliate-terms.html",
  "unsubscribe.html",
  "auth/callback.html",
];

test("package.json pins @vercel/analytics", () => {
  assert.equal(typeof pkg.dependencies["@vercel/analytics"], "string");
  assert.match(pkg.dependencies["@vercel/analytics"], /^\^2\./);
});

test("analytics bootstrap injects the official Vercel insights script", () => {
  assert.match(analyticsJs, /\/_vercel\/insights\/script\.js/);
  assert.match(analyticsJs, /window\.va = function va\(\)/);
  assert.match(analyticsJs, /window\.vaq\.push\(arguments\)/);
  assert.match(analyticsJs, /script\.defer = true/);
  assert.match(analyticsJs, /document\.head\.appendChild\(script\)/);
});

test("every public page mounts the Vercel Analytics bootstrap", () => {
  for (const file of publicHtmlFiles) {
    const html = readFileSync(join(root, file), "utf8");
    assert.match(
      html,
      /<script type="module" src="\/js\/vercel-analytics\.js"><\/script>/,
      `${file} is missing the Vercel Analytics bootstrap`,
    );
  }
});

test("repo HTML pages are all covered by the analytics mount list", () => {
  const rootHtml = readdirSync(root).filter((name) => name.endsWith(".html"));
  for (const file of rootHtml) {
    assert.ok(publicHtmlFiles.includes(file), `${file} is not in the analytics page list`);
  }
  assert.ok(publicHtmlFiles.includes("auth/callback.html"));
});

test("service worker lets Vercel insights traffic bypass the cache", () => {
  assert.match(serviceWorker, /CACHE_NAME = 'sineday-v20'/);
  assert.match(
    serviceWorker,
    /if \(url\.pathname\.startsWith\('\/_vercel\/'\)\) \{\s*return;\s*\}/,
  );
});
