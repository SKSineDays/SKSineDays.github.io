import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pages = [
  "accessibility.html",
  "affiliate-terms.html",
  "affiliate.html",
  "contact.html",
  "daily-confirm.html",
  "daily.html",
  "dashboard.html",
  "index.html",
  "login.html",
  "privacy.html",
  "refunds.html",
  "terms.html",
  "unsubscribe.html"
];

for (const page of pages) {
  test(`${page} includes the canonical SineDay Blog link in its footer`, () => {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0];
    assert.ok(footer, "Expected an existing footer");
    const nav = footer.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav, "Expected footer navigation");
    assert.equal((nav.match(/href="https:\/\/www\.sineday\.blog\/"/g) || []).length, 1);
    assert.match(nav, /<a href="https:\/\/www\.sineday\.blog\/">SineDay Blog<\/a>/);
    assert.match(nav, /href="\/privacy\.html"/);
    assert.match(nav, /href="\/contact\.html"/);
  });
}
