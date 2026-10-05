import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { generateDailyEmailCopy, refineDailyTemplate } from "../scripts/generate-daily-email-copy.mjs";
import { validateDailyTemplate } from "../scripts/audit-daily-email-templates.mjs";
import { DAILY_TEMPLATE_ALIASES, getDailyEmailSubject } from "../api/_lib/daily-email.js";

const current = join(process.cwd(), "docs/email-templates/20261004");
const previous = join(process.cwd(), "docs/email-templates/20260924");
const copy = JSON.parse(readFileSync(join(current, "copy.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(current, "template-manifest.json"), "utf8"));
const reflectionRow = /<tr><td data-sineday-surface="reflection"[^>]*>[\s\S]*?<\/td><\/tr>/;
const blogRow = /<tr><td data-sineday-surface="blog"[^>]*>[\s\S]*?<\/td><\/tr>/;
const footerRow = /<tr><td data-sineday-surface="footer"[^>]*>[\s\S]*?<\/td><\/tr>/;
const reflectionText = /Your Sine, through your eyes\n\n[\s\S]*?(?=Bring one thought back with you\.)/;
const words = (value) => value.trim().split(/\s+/).length;
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("daily copy generates all 18 HTML/text pairs deterministically with existing aliases", async () => {
  assert.equal(readdirSync(current).filter((name) => /^day-\d{2}\.html$/.test(name)).length, 18);
  assert.equal(readdirSync(current).filter((name) => /^day-\d{2}\.txt$/.test(name)).length, 18);
  assert.equal(copy.days.length, 18);
  assert.equal(new Set(copy.days.map(({ question }) => question)).size, 18);
  assert.equal(manifest.length, 18);
  assert.deepEqual(await generateDailyEmailCopy({ check: true }), manifest);
});

for (let day = 1; day <= 18; day += 1) {
  test(`Day ${day}: concise reflection, blog invitation, parity, and protected content`, () => {
    const stem = `day-${String(day).padStart(2, "0")}`;
    const html = readFileSync(join(current, `${stem}.html`), "utf8");
    const text = readFileSync(join(current, `${stem}.txt`), "utf8");
    const oldHtml = readFileSync(join(previous, `${stem}.html`), "utf8");
    const oldText = readFileSync(join(previous, `${stem}.txt`), "utf8");
    const entry = manifest[day - 1];
    const question = copy.days[day - 1].question;
    const section = text.match(reflectionText)[0];
    const oldSection = oldText.match(reflectionText)[0];

    assert.equal(entry.day, day);
    assert.equal(entry.alias, DAILY_TEMPLATE_ALIASES[day]);
    assert.equal(entry.subject, getDailyEmailSubject(day));
    assert.equal(hash(html), entry.html_sha256);
    assert.equal(hash(text), entry.text_sha256);
    assert.equal(hash(oldHtml), entry.previous_html_sha256);
    assert.equal(hash(oldText), entry.previous_text_sha256);
    assert.deepEqual(validateDailyTemplate({ ...entry, html, status: "published" }, day, entry.alias), []);

    // Keep each day's original reflective question and its open-ended caveat.
    assert.ok(oldSection.includes(question));
    assert.ok(oldSection.includes(copy.reflection_caveat));
    assert.ok(section.includes(question));
    assert.ok(section.includes(copy.reflection_caveat));
    assert.ok(section.includes(`Reply here or email ${copy.reply_address}. One sentence is enough.`));
    assert.ok(words(section) <= 50, `Reflection is ${words(section)} words`);
    assert.ok(words(section) < words(oldSection) * 0.5);
    assert.ok(text.length < oldText.length);
    for (const value of [question, copy.reflection_caveat, copy.reply_prefix, copy.reply_address, copy.reply_suffix]) {
      assert.ok(html.match(reflectionRow)[0].includes(value));
      assert.ok(section.includes(value));
    }

    // One secondary blog destination with no tracking, after the primary CTA.
    assert.equal(html.split(copy.blog_url).length - 1, 1);
    assert.equal(text.split(copy.blog_url).length - 1, 1);
    for (const value of [copy.blog_heading, copy.blog_invitation, copy.blog_link_text]) {
      assert.ok(html.match(blogRow)[0].includes(value));
      assert.ok(text.includes(value));
    }
    assert.match(html, /href="https:\/\/www\.sineday\.blog\/" ses:no-track="true"/);
    assert.ok(html.indexOf('href="https://sineday.app/dashboard.html"') < html.indexOf('data-sineday-surface="blog"'));
    assert.ok(html.indexOf('data-sineday-surface="blog"') < html.indexOf('data-sineday-surface="footer"'));
    assert.match(html.match(blogRow)[0], /display:inline-block;padding-top:11px;padding-bottom:11px/);
    assert.match(html, /<html lang="en" dir="ltr">/);
    assert.match(html, /<table lang="en" dir="ltr" role="presentation"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.equal((html.match(/<h2\b/g) || []).length, 2);
    for (const table of html.match(/<table\b[^>]*>/g)) assert.match(table, /role="presentation"/);
    for (const image of html.match(/<img\b[^>]*>/g)) assert.match(image, /alt="[^"\n]+"/);

    // Exact comparison guards every other byte: hero, preheader, guidance,
    // notice, main CTA, private-reply promise, and untracked opt-out all survive.
    const normalizedHtml = html
      .replace(reflectionRow, oldHtml.match(reflectionRow)[0])
      .replace(blogRow, "")
      .replace('<html lang="en" dir="ltr">', '<html lang="en">')
      .replace('<table lang="en" dir="ltr" role="presentation"', '<table role="presentation"');
    assert.equal(normalizedHtml, oldHtml);
    assert.equal(html.match(footerRow)[0], oldHtml.match(footerRow)[0]);
    const blogText = `${copy.blog_heading}\n\n${copy.blog_invitation}\n\n${copy.blog_link_text} (${copy.blog_url})\n\n`;
    assert.equal(text.replace(reflectionText, oldSection).replace(blogText, ""), oldText);
    assert.deepEqual(html.match(/\{\{\{[^}]+\}\}\}/g), oldHtml.match(/\{\{\{[^}]+\}\}\}/g));
    assert.doesNotMatch(html, /<(?:script|form|input|iframe)\b|utm_|[?&](?:email|user|token)=/i);
  });
}

test("generator stops on missing, duplicated, or already-refined source sections", () => {
  const html = readFileSync(join(previous, "day-01.html"), "utf8");
  const text = readFileSync(join(previous, "day-01.txt"), "utf8");
  assert.throws(() => refineDailyTemplate({ html: html.replace(reflectionRow, ""), text, day: 1, copy }), /expected one matching section/);
  assert.throws(() => refineDailyTemplate({ html: html + html.match(reflectionRow)[0], text, day: 1, copy }), /expected one matching section/);
  assert.throws(() => refineDailyTemplate({ html, text, day: 19, copy }), /Missing reflection question/);
  const refined = refineDailyTemplate({ html, text, day: 1, copy });
  assert.throws(() => refineDailyTemplate({ ...refined, day: 1, copy }), /expected one matching section/);
});

test("new copy colors meet AA body-text contrast on their exact surfaces", () => {
  function luminance(hex) {
    const channels = hex.match(/[\da-f]{2}/gi).map((pair) => {
      const value = parseInt(pair, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  for (const background of ["#101725", "#0A0D14"]) {
    for (const foreground of ["#F5F7FF", "#B7C2D9", "#C3CEE1", "#AFC9FF", "#9BB9FF"]) {
      const ratio = (luminance(foreground) + 0.05) / (luminance(background) + 0.05);
      assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio}`);
    }
  }
});

test("copy containing dollar replacement tokens stays literal and cannot duplicate markup", () => {
  const html = readFileSync(join(previous, "day-01.html"), "utf8");
  const text = readFileSync(join(previous, "day-01.txt"), "utf8");
  const literalCopy = { ...copy, blog_heading: "A literal $& $` $' marker" };
  const refined = refineDailyTemplate({ html, text, day: 1, copy: literalCopy });
  assert.equal((refined.html.match(/data-sineday-surface="footer"/g) || []).length, 1);
  assert.ok(refined.text.includes(literalCopy.blog_heading));
  assert.ok(refined.html.includes("A literal $&amp; $` $&#39; marker"));
});
