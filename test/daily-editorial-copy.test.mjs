import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DAILY_EDITORIAL_DIR, EDITORIAL_BASE_DIR, generateDailyEditorialCopy, reviseDailyEditorialTemplate, sharedEditorialCopy, validateEditorialCopy } from "../scripts/generate-daily-editorial-copy.mjs";
import { generateDailyEmailCopy } from "../scripts/generate-daily-email-copy.mjs";
import { validateDailyTemplate } from "../scripts/audit-daily-email-templates.mjs";
import { DAILY_SINEDAY_TITLES, DAILY_TEMPLATE_ALIASES, getDailyEmailSubject } from "../api/_lib/daily-email.js";

const copy = JSON.parse(readFileSync(join(DAILY_EDITORIAL_DIR, "copy.json"), "utf8"));
const shared = sharedEditorialCopy(copy);
const baselineCopy = JSON.parse(readFileSync(join(EDITORIAL_BASE_DIR, "copy.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(DAILY_EDITORIAL_DIR, "template-manifest.json"), "utf8"));
const identities = JSON.parse(readFileSync(new URL("../docs/email-templates/20260924/template-manifest.json", import.meta.url), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const words = (value) => value.trim().split(/\s+/).length;
const normalizeSpace = (value) => value.replace(/\s+/g, " ").trim();
const row = (name) => new RegExp(`<tr><td data-sineday-surface="${name}"[^>]*>[\\s\\S]*?<\\/td><\\/tr>`);
const read = (directory, day, extension) => readFileSync(join(directory, `day-${String(day).padStart(2, "0")}.${extension}`), "utf8");

// Independent visible-copy comparison: ignore head/style, hidden preheader and
// image alt text. Plain text spells out the same three web/opt-out hrefs.
function decoded(value) {
  return value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function visibleHtml(html) {
  return normalizeSpace(decoded(html.replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<p\b[^>]*style="display:none;[^>]*>[\s\S]*?<\/p>/, "")
    .replace(/<(?:\/?(?:p|h[1-6]|td|tr|table)|br)\b[^>]*>/g, " ")
    .replace(/<[^>]+>/g, "")));
}
function visibleText(text) {
  return normalizeSpace(text.replace(/ \((?:https:\/\/sineday\.app\/dashboard\.html|https:\/\/www\.sineday\.blog\/|\{\{\{OPT_OUT_URL\}\}\})\)/g, ""));
}

// Mask only six permitted visible text blocks and the hidden preheader. Every
// remaining byte (including all tag/attribute whitespace) must match baseline.
function maskHtml(html) {
  return html
    .replace(/(<p style="display:none;[^>]*>)[^<]*(<\/p>)/, "$1[preheader]$2")
    .replace(/(<p style="[^>]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^>]*>)[^<]*(<\/p>)/, "$1[subtitle]$2")
    .replace(/(<p style="[^>]*font-size:17px;line-height:1\.65;color:#E8ECF7;">)[^<]*(<\/p>)/g, "$1[body]$2")
    .replace(row("notice"), (section) => section.replace(/(<p style="[^>]*font-size:18px;[^>]*>)[^<]*(<\/p>)/, "$1[notice]$2"))
    .replace(row("reflection"), (section) => section
      .replace(/(<h2\b[^>]*>)[^<]*(<\/h2>)/, "$1[prompt]$2")
      .replace(/(<p style="[^>]*font-size:15px;[^>]*>)[^<]*(<\/p>)/, "$1[caveat]$2"));
}
function maskText(text) {
  return text.split("\n\n").map((block, index) => [2, 3, 4, 6, 8, 9].includes(index) ? `[editable ${index}]` : block).join("\n\n");
}

test("editorial source validates all 18 days and regenerates deterministic outputs", async () => {
  assert.equal(validateEditorialCopy(copy), copy);
  assert.deepEqual([...copy.days.map(({ day }) => day)].sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1));
  for (const field of ["core_point", "subtitle", "preheader", "notice", "writing_prompt"]) {
    assert.equal(new Set(copy.days.map((entry) => entry[field])).size, 18, `${field} must be day-specific`);
  }
  assert.equal(readdirSync(DAILY_EDITORIAL_DIR).filter((name) => /^day-\d{2}\.html$/.test(name)).length, 18);
  assert.equal(readdirSync(DAILY_EDITORIAL_DIR).filter((name) => /^day-\d{2}\.txt$/.test(name)).length, 18);
  assert.deepEqual(await generateDailyEditorialCopy({ check: true }), manifest);
  assert.equal((await generateDailyEmailCopy({ check: true })).length, 18, "Historical generator and snapshot stay valid");
});

for (let day = 1; day <= 18; day += 1) {
  test(`Day ${day}: editorial parity, brief reflection and byte-exact protected content`, () => {
    const entry = copy.days.find((entry) => entry.day === day);
    const html = read(DAILY_EDITORIAL_DIR, day, "html");
    const text = read(DAILY_EDITORIAL_DIR, day, "txt");
    const oldHtml = read(EDITORIAL_BASE_DIR, day, "html");
    const oldText = read(EDITORIAL_BASE_DIR, day, "txt");
    const record = manifest[day - 1];
    const identity = identities.find((identity) => identity.alias === record.alias);
    assert.equal(record.day, day);
    assert.equal(record.alias, DAILY_TEMPLATE_ALIASES[day]);
    assert.equal(record.subject, getDailyEmailSubject(day));
    assert.equal(record.template_id, identity.metadata_before.match(/^ID: (.+)$/m)[1]);
    assert.equal(record.template_identity_source, "20260924");
    assert.equal(record.previous_snapshot, "20261004");
    assert.equal(record.html_sha256, hash(html));
    assert.equal(record.text_sha256, hash(text));
    assert.equal(record.previous_html_sha256, hash(oldHtml));
    assert.equal(record.previous_text_sha256, hash(oldText));
    assert.deepEqual(validateDailyTemplate({ ...record, html, status: "published" }, day, record.alias), []);
    assert.equal(visibleHtml(html), visibleText(text), "Complete visible HTML must equal the complete plain-text alternative");
    assert.equal(maskHtml(html), maskHtml(oldHtml), "All bytes outside authorized copy interiors must be preserved");
    assert.equal(maskText(text), maskText(oldText), "All plain-text content outside authorized blocks must be preserved");
    assert.deepEqual(html.match(/<[^>]+>/g), oldHtml.match(/<[^>]+>/g), "Every tag, style and attribute remains byte-identical");
    assert.deepEqual(html.match(/<img\b[^>]*>/g), oldHtml.match(/<img\b[^>]*>/g));
    assert.deepEqual(html.match(/href="[^"]*"/g), oldHtml.match(/href="[^"]*"/g));
    assert.deepEqual(html.match(/\{\{\{[^}]+\}\}\}/g), oldHtml.match(/\{\{\{[^}]+\}\}\}/g));
    assert.deepEqual(text.match(/\{\{\{[^}]+\}\}\}/g), oldText.match(/\{\{\{[^}]+\}\}\}/g));
    assert.equal(html.match(row("blog"))[0], oldHtml.match(row("blog"))[0]);
    assert.equal(html.match(row("footer"))[0], oldHtml.match(row("footer"))[0]);
    assert.equal(text.split("\n\n")[1], DAILY_SINEDAY_TITLES[day]);
    const expectedBlocks = new Map([[2, entry.subtitle], [3, entry.paragraphs[0]], [4, entry.paragraphs[1]], [6, entry.notice], [8, entry.writing_prompt], [9, shared.reflection_caveat]]);
    for (const [index, value] of expectedBlocks) assert.equal(text.split("\n\n")[index], value);
    assert.equal(decoded(html.match(/<p style="display:none;[^>]*>([^<]*)<\/p>/)[1]), entry.preheader);
    const reflection = text.split("\n\n").slice(7, 11).join(" ");
    assert.ok(words(reflection) >= 39 && words(reflection) <= 50, `mySine is ${words(reflection)} words`);
    for (const field of ["reflection_label", "reply_prefix", "reply_address", "reply_suffix"]) assert.equal(shared[field], baselineCopy[field]);
    assert.ok(!text.includes(entry.diagnosis), "Review-only diagnosis must not leak into the email");
    assert.doesNotMatch(html, /<(?:script|form|input|iframe|object|embed)\b|\bon\w+\s*=|(?:javascript|vbscript):|utm_|[?&](?:email|user|token)=/i);
  });
}

test("schema rejects incomplete, duplicate, malformed or identity-changing copy", () => {
  function bad(change, message) { const altered = structuredClone(copy); change(altered); assert.throws(() => validateEditorialCopy(altered), message); }
  bad((value) => value.days.pop(), /18 days exactly once/);
  bad((value) => value.days[17].day = 1, /18 days exactly once/);
  bad((value) => value.days[17].day = 19, /Invalid editorial day/);
  bad((value) => value.days[0].day = "1", /Invalid editorial day/);
  bad((value) => value.days[0].paragraphs.pop(), /exactly two body paragraphs/);
  bad((value) => delete value.days[0].writing_prompt, /writing_prompt must be/);
  bad((value) => value.days[0].notice = "", /notice must be/);
  bad((value) => value.days[0].subtitle = "Split\nline", /single-line/);
  bad((value) => value.days[0].preheader = "{{{NEW_VARIABLE}}}", /template variables/);
  bad((value) => value.days[0].title = "New title", /canonical title/);
  bad((value) => value.days[0].phase = "Trough", /canonical phase/);
  bad((value) => value.reply_address = "someone@example.com", /Protected shared field/);
  bad((value) => value.blog_url = "https://example.com/", /Unexpected shared copy field/);
  bad((value) => value.days[0].writing_promtp = "Typo", /unexpected field/);
});

test("generator fails hard on every missing or duplicated copy surface in HTML and text", () => {
  const html = read(EDITORIAL_BASE_DIR, 1, "html");
  const text = read(EDITORIAL_BASE_DIR, 1, "txt");
  const targets = [
    /<p style="display:none;[^>]*>[^<]*<\/p>/,
    /<p style="[^>]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^>]*>[^<]*<\/p>/,
    /<p style="[^>]*font-size:17px;line-height:1\.65;color:#E8ECF7;">[^<]*<\/p>/,
    row("notice"), row("reflection")
  ];
  for (const target of targets) {
    assert.throws(() => reviseDailyEditorialTemplate({ html: html.replace(target, ""), text, day: 1, copy }), /matching section/);
    assert.throws(() => reviseDailyEditorialTemplate({ html: html + html.match(target)[0], text, day: 1, copy }), /matching section/);
  }
  for (const target of [/<h2\b[^>]*>[^<]*<\/h2>/, /<p style="[^>]*font-size:15px;line-height:1\.65;color:#B7C2D9;">[^<]*<\/p>/]) {
    const originalRow = html.match(row("reflection"))[0];
    const fragment = originalRow.match(target)[0];
    for (const replacement of [originalRow.replace(target, ""), originalRow.replace(target, () => fragment + fragment)]) {
      assert.throws(() => reviseDailyEditorialTemplate({ html: html.replace(originalRow, () => replacement), text, day: 1, copy }), /matching section/);
    }
  }
  for (const index of [2, 3, 4, 6, 8, 9]) {
    const block = text.split("\n\n")[index];
    assert.throws(() => reviseDailyEditorialTemplate({ html, text: text.replace(block, "Missing"), day: 1, copy }), /text .*matching section/);
    assert.throws(() => reviseDailyEditorialTemplate({ html, text: text + `\n${block}\n\n`, day: 1, copy }), /text .*matching section/);
  }
  assert.throws(() => reviseDailyEditorialTemplate({ html, text, day: 2, copy }), /source identity/);
  assert.throws(() => reviseDailyEditorialTemplate({ html, text, day: 19, copy }), /Missing editorial copy/);
});

test("dollar tokens stay literal, all editable HTML is escaped, and output cannot add active content", () => {
  const altered = structuredClone(copy);
  const marker = 'A literal $& $` $\' <img src=x onerror=alert(1)> & "quoted" value';
  const entry = altered.days[0];
  for (const key of ["preheader", "subtitle", "notice", "writing_prompt"]) entry[key] = `${key}: ${marker}`;
  entry.paragraphs = [`First: ${marker}`, `Second: ${marker}`];
  altered.reflection_caveat = `Caveat: ${marker}`;
  const html = read(EDITORIAL_BASE_DIR, 1, "html");
  const text = read(EDITORIAL_BASE_DIR, 1, "txt");
  const result = reviseDailyEditorialTemplate({ html, text, day: 1, copy: altered });
  assert.deepEqual(result.html.match(/<[^>]+>/g), html.match(/<[^>]+>/g));
  assert.equal(maskHtml(result.html), maskHtml(html));
  assert.equal(maskText(result.text), maskText(text));
  assert.equal((result.html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 7);
  assert.ok(result.html.includes("$&amp; $` $&#39;"));
  assert.equal(visibleHtml(result.html), visibleText(result.text));
});

test("check mode detects stale outputs without repairing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sineday-editorial-check-"));
  try {
    await writeFile(join(directory, "copy.json"), JSON.stringify(copy));
    await generateDailyEditorialCopy({ outputDirectory: directory });
    await generateDailyEditorialCopy({ outputDirectory: directory, check: true });
    await writeFile(join(directory, "day-01.html"), "stale sentinel");
    await assert.rejects(generateDailyEditorialCopy({ outputDirectory: directory, check: true }), /Generated file is stale: day-01.html/);
    assert.equal(await readFile(join(directory, "day-01.html"), "utf8"), "stale sentinel");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
