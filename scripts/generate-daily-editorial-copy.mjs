// Local review only. Reads immutable snapshots; never contacts an email service.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DAILY_SINEDAY_TITLES, DAILY_TEMPLATE_ALIASES, getDailyEmailSubject } from "../api/_lib/daily-email.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EDITORIAL_BASE_DIR = join(ROOT, "docs/email-templates/20261004");
export const DAILY_EDITORIAL_DIR = join(ROOT, "docs/email-templates/20261005");
const BASE_COPY = JSON.parse(readFileSync(join(EDITORIAL_BASE_DIR, "copy.json"), "utf8"));
const PHASES = ["Rising", "Ascending", "Ascending", "Ascending", "Ascending", "Peak", "Peak", "Peak", "Crest", "Descending", "Descending", "Descending", "Descending", "Trough", "Trough", "Trough", "Emerging", "Emerging"];
const FIXED_SHARED_FIELDS = ["reflection_label", "reply_prefix", "reply_address", "reply_suffix"];
const DAY_FIELDS = ["day", "title", "phase", "core_point", "diagnosis", "subtitle", "preheader", "paragraphs", "notice", "writing_prompt"];

// Each expression captures the opening tag, its text interior, and closing tag.
// Apart from the explicit root canvas-lock move below, no tags or attributes
// are regenerated: the surrounding email stays byte-exact.
const ROOT_CANVAS_STYLE = '<style type="text/css">:root{color-scheme:light only;}</style>';
const ORIGINAL_HTML_ROOT = '<html lang="en" dir="ltr">';
const INLINE_HTML_ROOT = '<html lang="en" dir="ltr" style="color-scheme:light only;">';
const PREHEADER = /(<p style="display:none;[^">]*">)([^<]*)(<\/p>)/g;
const SUBTITLE = /(<p style="[^">]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^">]*">)([^<]*)(<\/p>)/g;
const BODY_PARAGRAPH = /(<p style="[^">]*font-size:17px;line-height:1\.65;color:#E8ECF7;">)([^<]*)(<\/p>)/g;
const NOTICE = /(<p style="[^">]*font-size:18px;line-height:1\.65;color:#E8ECF7;">)([^<]*)(<\/p>)/g;
const PROMPT = /(<h2\b[^>]*>)([^<]*)(<\/h2>)/g;
const CAVEAT = /(<p style="[^">]*font-size:15px;line-height:1\.65;color:#B7C2D9;">)([^<]*)(<\/p>)/g;
const reflectionRow = /<tr><td data-sineday-surface="reflection"[^>]*>[\s\S]*?<\/td><\/tr>/g;
const noticeRow = /<tr><td data-sineday-surface="notice"[^>]*>[\s\S]*?<\/td><\/tr>/g;

export function escapeEditorialHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function decodeHtml(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
    if (entity.toLowerCase() in named) return named[entity.toLowerCase()];
    return String.fromCodePoint(parseInt(entity.slice(entity[2].toLowerCase() === "x" ? 3 : 2, -1), entity[2].toLowerCase() === "x" ? 16 : 10));
  });
}

function matchesExactly(source, pattern, count, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== count) throw new Error(`${label}: expected ${count} matching section${count === 1 ? "" : "s"}, found ${matches.length}`);
  return matches;
}

function replaceTextInteriors(source, pattern, values, label) {
  matchesExactly(source, pattern, values.length, label);
  let index = 0;
  return source.replace(pattern, (_all, open, _old, close) => `${open}${escapeEditorialHtml(values[index++])}${close}`);
}

function replaceLiteralOnce(source, target, value, label) {
  const count = source.split(target).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 matching section, found ${count}`);
  // A callback preserves literal replacement tokens such as $&, $` and $'.
  return source.replace(target, () => value);
}

function inlineRootCanvasLock(html, day) {
  // Resend's current update contract excludes style elements. Move only the
  // existing :root declaration to the same root element; keep all other locks.
  matchesExactly(html, /<html\b[^>]*>/gi, 1, `Day ${day} HTML root`);
  matchesExactly(html, /<style\b[^>]*>/gi, 1, `Day ${day} canvas style element`);
  matchesExactly(html, /<\/style\s*>/gi, 1, `Day ${day} canvas style closing tag`);
  const withoutStyle = replaceLiteralOnce(html, ROOT_CANVAS_STYLE, "", `Day ${day} exact root canvas style`);
  return replaceLiteralOnce(withoutStyle, ORIGINAL_HTML_ROOT, INLINE_HTML_ROOT, `Day ${day} exact HTML root`);
}

function nonemptyText(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\r\n\u0000]/.test(value)) {
    throw new Error(`${label} must be a nonempty, trimmed, single-line string`);
  }
  if (/\{\{/.test(value)) throw new Error(`${label} cannot introduce template variables`);
}

export function sharedEditorialCopy(copy) {
  return Object.fromEntries([...FIXED_SHARED_FIELDS, "reflection_caveat"].map((key) => [key, copy[key] ?? BASE_COPY[key]]));
}

export function validateEditorialCopy(copy) {
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) throw new Error("Editorial copy must be an object");
  const allowed = new Set(["days", ...FIXED_SHARED_FIELDS, "reflection_caveat", "collection_diagnosis", "editorial_basis", "preservation_note"]);
  for (const key of Object.keys(copy)) if (!allowed.has(key)) throw new Error(`Unexpected shared copy field: ${key}`);
  for (const key of ["collection_diagnosis", "editorial_basis", "preservation_note"]) {
    if (key in copy) nonemptyText(copy[key], key);
  }
  if (!Array.isArray(copy.days) || copy.days.length !== 18 || new Set(copy.days.map((entry) => entry?.day)).size !== 18) {
    throw new Error("Editorial copy must contain each of the 18 days exactly once");
  }
  const shared = sharedEditorialCopy(copy);
  for (const key of FIXED_SHARED_FIELDS) {
    if (shared[key] !== BASE_COPY[key]) throw new Error(`Protected shared field changed: ${key}`);
  }
  nonemptyText(shared.reflection_caveat, "reflection_caveat");
  for (const entry of copy.days) {
    if (!entry || !Number.isInteger(entry.day) || entry.day < 1 || entry.day > 18) throw new Error("Invalid editorial day");
    for (const key of Object.keys(entry)) if (!DAY_FIELDS.includes(key)) throw new Error(`Day ${entry.day}: unexpected field ${key}`);
    for (const key of DAY_FIELDS.filter((key) => !["day", "paragraphs"].includes(key))) nonemptyText(entry[key], `Day ${entry.day} ${key}`);
    if (entry.title !== DAILY_SINEDAY_TITLES[entry.day]) throw new Error(`Day ${entry.day}: canonical title changed`);
    if (entry.phase !== PHASES[entry.day - 1]) throw new Error(`Day ${entry.day}: canonical phase changed`);
    if (!Array.isArray(entry.paragraphs) || entry.paragraphs.length !== 2) throw new Error(`Day ${entry.day}: exactly two body paragraphs required`);
    entry.paragraphs.forEach((value, index) => nonemptyText(value, `Day ${entry.day} paragraph ${index + 1}`));
  }
  return copy;
}

export function reviseDailyEditorialTemplate({ html, text, day, copy }) {
  validateEditorialCopy(copy);
  const entry = copy.days.find((candidate) => candidate.day === day);
  if (!entry) throw new Error(`Missing editorial copy for Day ${day}`);
  const shared = sharedEditorialCopy(copy);
  matchesExactly(html, PREHEADER, 1, `Day ${day} preheader`);
  const subtitle = matchesExactly(html, SUBTITLE, 1, `Day ${day} subtitle`)[0];
  const paragraphs = matchesExactly(html, BODY_PARAGRAPH, 2, `Day ${day} body paragraphs`);
  const notice = matchesExactly(html, noticeRow, 1, `Day ${day} Notice today row`)[0][0];
  const oldNotice = matchesExactly(notice, NOTICE, 1, `Day ${day} Notice today text`)[0][2];
  const reflection = matchesExactly(html, reflectionRow, 1, `Day ${day} reflection row`)[0][0];
  const oldPrompt = matchesExactly(reflection, PROMPT, 1, `Day ${day} writing prompt`)[0][2];
  const oldCaveat = matchesExactly(reflection, CAVEAT, 1, `Day ${day} caveat`)[0][2];
  // Prevent applying an entry to a different day, without changing the identity.
  const headerText = `Day ${day} • ${entry.phase}`;
  if (!html.includes(`>${headerText}</p>`) || !text.startsWith(`${headerText}\n\n${entry.title}\n\n`)) {
    throw new Error(`Day ${day}: source identity does not match canonical title/phase`);
  }
  let revisedHtml = inlineRootCanvasLock(html, day);
  revisedHtml = replaceTextInteriors(revisedHtml, PREHEADER, [entry.preheader], `Day ${day} preheader`);
  revisedHtml = replaceTextInteriors(revisedHtml, SUBTITLE, [entry.subtitle], `Day ${day} subtitle`);
  revisedHtml = replaceTextInteriors(revisedHtml, BODY_PARAGRAPH, entry.paragraphs, `Day ${day} body paragraphs`);
  const revisedNotice = replaceTextInteriors(notice, NOTICE, [entry.notice], `Day ${day} notice`);
  revisedHtml = replaceLiteralOnce(revisedHtml, notice, revisedNotice, `Day ${day} notice row`);
  let revisedReflection = replaceTextInteriors(reflection, PROMPT, [entry.writing_prompt], `Day ${day} writing prompt`);
  revisedReflection = replaceTextInteriors(revisedReflection, CAVEAT, [shared.reflection_caveat], `Day ${day} caveat`);
  revisedHtml = replaceLiteralOnce(revisedHtml, reflection, revisedReflection, `Day ${day} reflection row`);

  // Plain text has no hidden preheader. Replace the matching complete paragraphs
  // in one pass so repeated replacement text can never become a later target.
  const replacements = [
    [decodeHtml(subtitle[2]), entry.subtitle, "subtitle"],
    ...paragraphs.map((match, index) => [decodeHtml(match[2]), entry.paragraphs[index], `paragraph ${index + 1}`]),
    [decodeHtml(oldNotice), entry.notice, "notice"],
    [decodeHtml(oldPrompt), entry.writing_prompt, "writing prompt"],
    [decodeHtml(oldCaveat), shared.reflection_caveat, "caveat"]
  ];
  const blocks = text.split("\n\n");
  const targets = new Map();
  for (const [oldValue, newValue, label] of replacements) {
    const matches = blocks.filter((block) => block === oldValue).length;
    if (matches !== 1) throw new Error(`Day ${day} text ${label}: expected 1 matching section, found ${matches}`);
    if (targets.has(oldValue)) throw new Error(`Day ${day}: duplicate text replacement target`);
    targets.set(oldValue, newValue);
  }
  const revisedText = blocks.map((block) => targets.get(block) ?? block).join("\n\n");
  return { html: revisedHtml, text: revisedText };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export async function generateDailyEditorialCopy({ check = false, outputDirectory = DAILY_EDITORIAL_DIR } = {}) {
  const copy = validateEditorialCopy(JSON.parse(await readFile(join(outputDirectory, "copy.json"), "utf8")));
  const previousManifest = JSON.parse(await readFile(join(EDITORIAL_BASE_DIR, "template-manifest.json"), "utf8"));
  const identityManifest = JSON.parse(await readFile(join(ROOT, "docs/email-templates/20260924/template-manifest.json"), "utf8"));
  const manifest = [];
  const outputs = [];
  for (let day = 1; day <= 18; day += 1) {
    const stem = `day-${String(day).padStart(2, "0")}`;
    const html = await readFile(join(EDITORIAL_BASE_DIR, `${stem}.html`), "utf8");
    const text = await readFile(join(EDITORIAL_BASE_DIR, `${stem}.txt`), "utf8");
    const previous = previousManifest.find((entry) => entry.day === day);
    const alias = DAILY_TEMPLATE_ALIASES[day];
    if (previous?.alias !== alias || previous?.subject !== getDailyEmailSubject(day) || previous.html_sha256 !== sha256(html) || previous.text_sha256 !== sha256(text)) {
      throw new Error(`Day ${day}: previous snapshot does not match its manifest`);
    }
    const identity = identityManifest.find((entry) => entry.alias === alias);
    const templateId = identity?.metadata_before.match(/^ID: ([\da-f-]+)$/m)?.[1];
    if (!templateId) throw new Error(`Day ${day}: missing archived template identity`);
    const revised = reviseDailyEditorialTemplate({ html, text, day, copy });
    outputs.push([`${stem}.html`, revised.html], [`${stem}.txt`, revised.text]);
    manifest.push({
      day, alias, template_id: templateId, template_identity_source: "20260924",
      subject: getDailyEmailSubject(day),
      html: `${stem}.html`, html_sha256: sha256(revised.html),
      text: `${stem}.txt`, text_sha256: sha256(revised.text),
      previous_snapshot: "20261004",
      previous_html_sha256: sha256(html), previous_text_sha256: sha256(text),
      hero_url: previous.hero_url, blog_url: previous.blog_url
    });
  }
  outputs.push(["template-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`]);
  if (!check) await mkdir(outputDirectory, { recursive: true });
  for (const [name, content] of outputs) {
    const path = join(outputDirectory, name);
    if (check) {
      if (await readFile(path, "utf8") !== content) throw new Error(`Generated file is stale: ${name}`);
    } else await writeFile(path, content);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  const check = process.argv.includes("--check");
  const manifest = await generateDailyEditorialCopy({ check });
  console.log(`${check ? "Verified" : "Generated"} ${manifest.length} editorial HTML/text pairs. Local review only; no live templates changed.`);
}
