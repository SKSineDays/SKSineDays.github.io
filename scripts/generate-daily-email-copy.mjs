import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAILY_TEMPLATE_ALIASES, getDailyEmailSubject } from "../api/_lib/daily-email.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_DIR = join(ROOT, "docs/email-templates/20260924");
export const DAILY_COPY_DIR = join(ROOT, "docs/email-templates/20261004");
const REFLECTION_ROW = /<tr><td data-sineday-surface="reflection"[^>]*>[\s\S]*?<\/td><\/tr>/g;
const FOOTER_START = '<tr><td data-sineday-surface="footer"';
const FOOTER_TEXT_START = "SineDay gives the wave language. Your life gives that language meaning.";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function replaceOnce(source, target, replacement, label) {
  const matches = typeof target === "string"
    ? source.split(target).length - 1
    : [...source.matchAll(target)].length;
  if (matches !== 1) throw new Error(`${label}: expected one matching section, found ${matches}`);
  return source.replace(target, () => replacement);
}

const sans = "font-family:Arial, Helvetica, sans-serif;";
const margin = "margin-top:0;margin-right:0;margin-left:0;";

export function reflectionHtml(copy, question) {
  return '<tr><td data-sineday-surface="reflection" bgcolor="#101725" style="background-color:#101725;padding-top:28px;padding-right:24px;padding-bottom:28px;padding-left:24px;">' +
    `<p style="${margin}margin-bottom:12px;${sans}font-size:12px;line-height:1.5;font-weight:bold;letter-spacing:1.3px;color:#9BB9FF;text-transform:uppercase;">${escapeHtml(copy.reflection_label)}</p>` +
    `<h2 style="${margin}margin-bottom:16px;font-family:Georgia, Times New Roman, serif;font-size:26px;line-height:1.3;font-weight:normal;color:#F5F7FF;">${escapeHtml(question)}</h2>` +
    `<p style="${margin}margin-bottom:16px;${sans}font-size:15px;line-height:1.65;color:#B7C2D9;">${escapeHtml(copy.reflection_caveat)}</p>` +
    `<p style="${margin}margin-bottom:0;${sans}font-size:16px;line-height:1.65;color:#C3CEE1;">${escapeHtml(copy.reply_prefix)} <a href="mailto:${escapeHtml(copy.reply_address)}" style="color:#AFC9FF;${sans}font-size:16px;line-height:1.65;text-decoration:underline;">${escapeHtml(copy.reply_address)}</a>. ${escapeHtml(copy.reply_suffix)}</p>` +
    '</td></tr>';
}

export function blogHtml(copy) {
  return '<tr><td data-sineday-surface="blog" bgcolor="#0A0D14" style="background-color:#0A0D14;border-top:1px solid #263146;padding-top:24px;padding-right:24px;padding-bottom:24px;padding-left:24px;">' +
    `<h2 style="${margin}margin-bottom:8px;font-family:Georgia, Times New Roman, serif;font-size:22px;line-height:1.4;font-weight:normal;color:#F5F7FF;">${escapeHtml(copy.blog_heading)}</h2>` +
    `<p style="${margin}margin-bottom:4px;${sans}font-size:15px;line-height:1.65;color:#B7C2D9;">${escapeHtml(copy.blog_invitation)}</p>` +
    `<a href="${escapeHtml(copy.blog_url)}" ses:no-track="true" style="display:inline-block;padding-top:11px;padding-bottom:11px;color:#AFC9FF;${sans}font-size:16px;line-height:22px;text-decoration:underline;">${escapeHtml(copy.blog_link_text)}</a>` +
    '</td></tr>';
}

export function reflectionText(copy, question) {
  return `${copy.reflection_label}\n\n${question}\n\n${copy.reflection_caveat}\n\n${copy.reply_prefix} ${copy.reply_address}. ${copy.reply_suffix}\n\n`;
}

export function blogText(copy) {
  return `${copy.blog_heading}\n\n${copy.blog_invitation}\n\n${copy.blog_link_text} (${copy.blog_url})\n\n`;
}

export function refineDailyTemplate({ html, text, day, copy }) {
  const question = copy.days.find((entry) => entry.day === day)?.question;
  if (!question) throw new Error(`Missing reflection question for Day ${day}`);
  let refinedHtml = replaceOnce(html, REFLECTION_ROW, reflectionHtml(copy, question), `Day ${day} HTML reflection`);
  refinedHtml = replaceOnce(refinedHtml, FOOTER_START, blogHtml(copy) + FOOTER_START, `Day ${day} HTML footer`);
  // Repeat language/direction on the outer layout table for clients that remove <html>.
  refinedHtml = replaceOnce(refinedHtml, '<html lang="en">', '<html lang="en" dir="ltr">', `Day ${day} language`);
  refinedHtml = replaceOnce(refinedHtml, '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#05060A"', '<table lang="en" dir="ltr" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#05060A"', `Day ${day} layout language`);
  const oldReflection = /Your Sine, through your eyes\n\n[\s\S]*?(?=Bring one thought back with you\.)/g;
  let refinedText = replaceOnce(text, oldReflection, reflectionText(copy, question), `Day ${day} text reflection`);
  refinedText = replaceOnce(refinedText, FOOTER_TEXT_START, blogText(copy) + FOOTER_TEXT_START, `Day ${day} text footer`);
  return { html: refinedHtml, text: refinedText };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function generateDailyEmailCopy({ check = false } = {}) {
  const copy = JSON.parse(await readFile(join(DAILY_COPY_DIR, "copy.json"), "utf8"));
  const days = copy.days.map(({ day }) => day);
  if (days.length !== 18 || new Set(days).size !== 18 || days.some((day) => !DAILY_TEMPLATE_ALIASES[day])) {
    throw new Error("Daily copy must contain each of the 18 days exactly once");
  }
  if (copy.blog_url !== "https://www.sineday.blog/" || copy.reply_address !== "mysine@sineday.app") {
    throw new Error("Unexpected blog or reply destination");
  }
  await mkdir(DAILY_COPY_DIR, { recursive: true });
  const manifest = [];
  const outputs = [];
  for (let day = 1; day <= 18; day += 1) {
    const stem = `day-${String(day).padStart(2, "0")}`;
    const html = await readFile(join(BASE_DIR, `${stem}.html`), "utf8");
    const text = await readFile(join(BASE_DIR, `${stem}.txt`), "utf8");
    const refined = refineDailyTemplate({ html, text, day, copy });
    outputs.push([`${stem}.html`, refined.html], [`${stem}.txt`, refined.text]);
    manifest.push({
      day,
      alias: DAILY_TEMPLATE_ALIASES[day],
      subject: getDailyEmailSubject(day),
      html: `${stem}.html`, html_sha256: sha256(refined.html),
      text: `${stem}.txt`, text_sha256: sha256(refined.text),
      previous_snapshot: "20260924",
      previous_html_sha256: sha256(html), previous_text_sha256: sha256(text),
      hero_url: `https://sineday.app/assets/email/20260924/scenes/SineDayScene${day}.png`,
      blog_url: copy.blog_url
    });
  }
  outputs.push(["template-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`]);
  for (const [name, content] of outputs) {
    const path = join(DAILY_COPY_DIR, name);
    if (check) {
      if (await readFile(path, "utf8") !== content) throw new Error(`Generated file is stale: ${name}`);
    } else await writeFile(path, content);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const check = process.argv.includes("--check");
  const manifest = await generateDailyEmailCopy({ check });
  console.log(`${check ? "Verified" : "Generated"} ${manifest.length} daily HTML/text pairs. No live templates changed.`);
}
