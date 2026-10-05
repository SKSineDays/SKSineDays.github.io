// Local, additive review generator. No email-service, network, or publication calls.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DAY_DATA, DAY_DETAILS } from '../js/sineday-engine.js';
import { DAILY_SINEDAY_TITLES, DAILY_TEMPLATE_ALIASES, getDailyEmailSubject } from '../api/_lib/daily-email.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CARD_SOURCE = 'js/sineday-engine.js';
export const CARD_BASE_DIR = join(ROOT, 'docs/email-templates/20261005');
export const CARD_ALIGNED_DIR = join(ROOT, 'docs/email-templates/20261005-card-aligned');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decodeHtml = (value) => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const PREHEADER = /(<p style="display:none;[^">]*">)([^<]*)(<\/p>)/g;
const SUBTITLE = /(<p style="[^">]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^">]*">)([^<]*)(<\/p>)/g;
const BODY = /(<p style="[^">]*font-size:17px;line-height:1\.65;color:#E8ECF7;">)([^<]*)(<\/p>)/g;
const NOTICE = /(<p style="[^">]*font-size:18px;line-height:1\.65;color:#E8ECF7;">)([^<]*)(<\/p>)/g;
const QUESTION = /(<h2\b[^>]*>)([^<]*)(<\/h2>)/g;
const CAVEAT = /(<p style="[^">]*font-size:15px;line-height:1\.65;color:#B7C2D9;">)([^<]*)(<\/p>)/g;
const row = (name) => new RegExp(`<tr><td data-sineday-surface="${name}"[^>]*>[\\s\\S]*?<\\/td><\\/tr>`, 'g');
const REMOVED_CAVEAT = 'Your writing can come from life or be entirely made up.';
const DAY_FIELDS = ['day', 'title', 'phase', 'subtitle', 'paragraph', 'bullets', 'question'];
const LIST_STYLE = 'margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;padding-left:22px;font-family:Arial, Helvetica, sans-serif;font-size:18px;line-height:1.65;color:#E8ECF7;';

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: unexpected field ${key}`);
  for (const key of keys) if (!(key in value)) throw new Error(`${label}: missing field ${key}`);
}
function singleLine(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\r\n\u0000]/.test(value)) throw new Error(`${label}: expected nonempty trimmed single-line text`);
  if (/\{\{/.test(value)) throw new Error(`${label}: cannot introduce template variables`);
}
export function validateIdentities(records, label) {
  if (!Array.isArray(records) || records.length !== 18 || new Set(records.map((entry) => entry?.day)).size !== 18 || records.some((entry) => !Number.isInteger(entry?.day) || entry.day < 1 || entry.day > 18)) {
    throw new Error(`${label}: must contain each of the 18 day identities exactly once`);
  }
}
export function websiteCard(day) {
  const data = DAY_DATA.find((entry) => entry.day === day);
  const detail = DAY_DETAILS[day];
  if (!data || !detail) throw new Error(`Day ${day}: missing website source`);
  const parts = data.phase.split(' • ');
  if (parts.length !== 2 || parts[1] !== DAILY_SINEDAY_TITLES[day]?.toUpperCase()) throw new Error(`Day ${day}: website title identity mismatch`);
  return { day, title: DAILY_SINEDAY_TITLES[day], phase: parts[0][0] + parts[0].slice(1).toLowerCase(), subtitle: data.description, paragraph: detail.paragraph, bullets: [...detail.bullets] };
}
export function validateCardAlignedCopy(copy) {
  exactKeys(copy, ['schemaVersion', 'source', 'days'], 'Card copy');
  if (copy.schemaVersion !== 1 || copy.source !== CARD_SOURCE) throw new Error('Card copy: unsupported schema or source');
  validateIdentities(DAY_DATA, 'Website DAY_DATA');
  if (Object.keys(DAY_DETAILS).length !== 18 || Object.keys(DAY_DETAILS).some((key) => !/^(?:[1-9]|1[0-8])$/.test(key))) throw new Error('Website DAY_DETAILS identities must be exactly 1–18');
  validateIdentities(copy.days, 'Card copy');
  for (const entry of copy.days) {
    const label = `Day ${entry.day}`;
    exactKeys(entry, DAY_FIELDS, label);
    const expected = websiteCard(entry.day);
    for (const key of ['title', 'phase', 'subtitle', 'paragraph']) {
      singleLine(entry[key], `${label} ${key}`);
      if (entry[key] !== expected[key]) throw new Error(`${label}: ${key} differs from exact website source`);
    }
    if (!Array.isArray(entry.bullets) || entry.bullets.length !== 4 || JSON.stringify(entry.bullets) !== JSON.stringify(expected.bullets)) throw new Error(`${label}: bullets differ from exact website source`);
    entry.bullets.forEach((value) => singleLine(value, `${label} bullet`));
    singleLine(entry.question, `${label} question`);
    if (!/^(?:Looking back[^?]*, )?(?:what|which|where|when|how|who|why|is|are|does|do|has|have|can|could|would|will)\b/i.test(entry.question) || !entry.question.endsWith('?') || (entry.question.match(/\?/g) || []).length !== 1 || !/\b(?:you|your|yours|yourself)\b/i.test(entry.question)) throw new Error(`${label}: reflection must be one direct reader question`);
    if (/\b(?:write|writing|rewrite|draft|compose|describe|tell|imagine|invent|fiction|fictional|story|stories|character|scene|journal|narrate|list)\b|made[- ]up|reflect on|think of|picture this|[<>]/i.test(entry.question)) throw new Error(`${label}: reflection cannot be a writing or imagined assignment`);
    if (entry.question.split(/\s+/).length > 45) throw new Error(`${label}: reflection question exceeds 45 words`);
  }
  if (new Set(copy.days.map((entry) => entry.question)).size !== 18) throw new Error('Every day needs its own distinct reader question');
  return copy;
}
function matches(source, pattern, count, label) {
  const values = [...source.matchAll(pattern)];
  if (values.length !== count) throw new Error(`${label}: expected ${count} matching sections, found ${values.length}`);
  return values;
}
function once(source, target, value, label) {
  if (source.split(target).length !== 2) throw new Error(`${label}: expected 1 matching section`);
  return source.replace(target, () => value);
}
function changeText(source, match, value, label) { return once(source, match[0], `${match[1]}${escapeHtml(value)}${match[3]}`, label); }
export function cardPreheader(entry) { return `Day ${entry.day} · ${entry.title}. ${entry.subtitle}.`; }
export function cardBulletsHtml(bullets) {
  return `<ul style="${LIST_STYLE}">${bullets.map((value, index) => `<li style="margin-top:0;margin-right:0;margin-bottom:${index === bullets.length - 1 ? 0 : 8}px;margin-left:0;padding-left:0;font-family:Arial, Helvetica, sans-serif;font-size:18px;line-height:1.65;color:#E8ECF7;">${escapeHtml(value)}</li>`).join('')}</ul>`;
}

export function reviseCardAlignedTemplate({ html, text, day, copy }) {
  validateCardAlignedCopy(copy);
  const entry = copy.days.find((candidate) => candidate.day === day);
  if (!entry) throw new Error(`Missing card copy for Day ${day}`);
  const preheader = matches(html, PREHEADER, 1, `Day ${day} preheader`)[0];
  const subtitle = matches(html, SUBTITLE, 1, `Day ${day} subtitle`)[0];
  const paragraphs = matches(html, BODY, 2, `Day ${day} body paragraphs`);
  const noticeRow = matches(html, row('notice'), 1, `Day ${day} notice row`)[0][0];
  const notice = matches(noticeRow, NOTICE, 1, `Day ${day} notice text`)[0];
  const reflectionRow = matches(html, row('reflection'), 1, `Day ${day} reflection row`)[0][0];
  const question = matches(reflectionRow, QUESTION, 1, `Day ${day} reflection question`)[0];
  const caveat = matches(reflectionRow, CAVEAT, 1, `Day ${day} reflection caveat`)[0];
  if (decodeHtml(caveat[2]) !== REMOVED_CAVEAT) throw new Error(`Day ${day}: unexpected baseline caveat`);
  if (!html.includes(`>Day ${day} • ${entry.phase}</p>`) || !html.includes(`>${entry.title}</h1>`) || !text.startsWith(`Day ${day} • ${entry.phase}\n\n${entry.title}\n\n`)) throw new Error(`Day ${day}: source identity mismatch`);

  let revisedHtml = changeText(html, preheader, cardPreheader(entry), `Day ${day} preheader`);
  revisedHtml = changeText(revisedHtml, subtitle, entry.subtitle, `Day ${day} subtitle`);
  revisedHtml = changeText(revisedHtml, paragraphs[0], entry.paragraph, `Day ${day} paragraph`);
  revisedHtml = once(revisedHtml, paragraphs[1][0], '', `Day ${day} obsolete paragraph`);
  revisedHtml = once(revisedHtml, noticeRow, once(noticeRow, notice[0], cardBulletsHtml(entry.bullets), `Day ${day} notice list`), `Day ${day} notice row`);
  let revisedReflection = changeText(reflectionRow, question, entry.question, `Day ${day} reflection question`);
  revisedReflection = once(revisedReflection, caveat[0], '', `Day ${day} removed caveat`);
  revisedHtml = once(revisedHtml, reflectionRow, revisedReflection, `Day ${day} reflection row`);

  const replacements = [
    [decodeHtml(subtitle[2]), entry.subtitle, 'subtitle'],
    [decodeHtml(paragraphs[0][2]), entry.paragraph, 'paragraph'],
    [decodeHtml(paragraphs[1][2]), null, 'obsolete paragraph'],
    [decodeHtml(notice[2]), entry.bullets.map((bullet) => `• ${bullet}`).join('\n'), 'notice list'],
    [decodeHtml(question[2]), entry.question, 'reflection question'],
    [decodeHtml(caveat[2]), null, 'removed caveat']
  ];
  const blocks = text.split('\n\n');
  const targets = new Map();
  for (const [oldValue, newValue, label] of replacements) {
    if (blocks.filter((block) => block === oldValue).length !== 1 || targets.has(oldValue)) throw new Error(`Day ${day} text ${label}: expected 1 matching section`);
    targets.set(oldValue, newValue);
  }
  const revisedText = blocks.flatMap((block) => targets.has(block) ? targets.get(block) === null ? [] : [targets.get(block)] : [block]).join('\n\n');
  return { html: revisedHtml, text: revisedText };
}

function previewHtml(copy, outputs) {
  // Only preview srcdoc image paths are localised. Production HTML stays exact.
  const frames = Object.fromEntries(copy.days.map(({ day }) => [day, outputs.find(([name]) => name === `day-${String(day).padStart(2, '0')}.html`)[1].replace(/https:\/\/sineday\.app\/assets\//g, '../../../assets/')]));
  const payload = JSON.stringify({ days: copy.days, frames }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SineDay · website-card mailer review</title><style>body{margin:0;background:#171c26;color:#eef3ff;font:16px/1.55 Arial,sans-serif}header{padding:24px;background:#0a0d14}h1{font-size:24px;margin:0 0 8px}h2{font-size:22px}p{max-width:78ch}a{color:#afc9ff}nav{display:flex;flex-wrap:wrap;gap:8px}button,select{font:inherit;color:#eef3ff;background:#263146;border:1px solid #7689aa;border-radius:5px;padding:7px 11px;cursor:pointer}button[aria-pressed=true]{background:#afc9ff;color:#05060a}main{display:flex;align-items:flex-start;gap:28px;padding:24px;flex-wrap:wrap}.source{max-width:420px;background:#101725;padding:24px;border:1px solid #51627b;border-radius:8px}li{margin-bottom:8px}iframe{display:block;border:1px solid #51627b;background:#05060a;width:375px;height:2500px;margin-top:16px}label{margin-right:8px}.note{font-size:14px;color:#bdc8dc}a:focus-visible,button:focus-visible,select:focus-visible{outline:3px solid #afc9ff;outline-offset:3px}</style></head><body><header><h1>Daily SineDay · website-card review</h1><p>All 18 mailers. Exact website subtitle, paragraph and four bullets, followed by one reader question. Local review only; no live templates changed.</p><nav id="days" aria-label="Choose a day"></nav></header><main><section class="source" aria-label="Website card source"><p class="note">Exact source: js/sineday-engine.js</p><h2 id="identity"></h2><p id="subtitle"></p><p id="paragraph"></p><ul id="bullets"></ul><h2>Reader question</h2><p id="question"></p><p><a id="html">Original HTML</a> · <a id="text">Plain text</a></p><p class="note">Website card wording is reproduced verbatim, including its existing journaling suggestions. The reader question adds no writing or fictional assignment.</p></section><section aria-label="Email preview"><label for="width">Preview width</label><select id="width"><option value="320">320px narrow</option><option value="375" selected>375px mobile</option><option value="520">520px desktop</option></select><iframe title="Daily SineDay email preview" sandbox="allow-same-origin"></iframe></section></main><script type="application/json" id="payload">${payload}</script><script>const {days,frames}=JSON.parse(document.getElementById('payload').textContent);const frame=document.querySelector('iframe');const choose=(day)=>{const entry=days.find(d=>d.day===day);document.getElementById('identity').textContent='Day '+day+' · '+entry.phase+' · '+entry.title;for(const name of ['subtitle','paragraph','question'])document.getElementById(name).textContent=entry[name];document.getElementById('bullets').replaceChildren(...entry.bullets.map(text=>{const li=document.createElement('li');li.textContent=text;return li}));const stem='day-'+String(day).padStart(2,'0');document.getElementById('html').href=stem+'.html';document.getElementById('text').href=stem+'.txt';frame.srcdoc=frames[day];document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.day)===day)))};for(const entry of days){const button=document.createElement('button');button.type='button';button.dataset.day=entry.day;button.textContent='Day '+entry.day;button.addEventListener('click',()=>choose(entry.day));document.getElementById('days').append(button)}document.getElementById('width').addEventListener('change',event=>frame.style.width=event.target.value+'px');frame.addEventListener('load',()=>{frame.style.height=frame.contentDocument.documentElement.scrollHeight+'px'});choose(1);</script></body></html>\n`;
}

export async function generateCardAlignedMailers({ check = false, outputDirectory = CARD_ALIGNED_DIR } = {}) {
  const copy = validateCardAlignedCopy(JSON.parse(await readFile(join(outputDirectory, 'copy.json'), 'utf8')));
  const previousManifest = JSON.parse(await readFile(join(CARD_BASE_DIR, 'template-manifest.json'), 'utf8'));
  validateIdentities(previousManifest, 'Baseline manifest');
  if (new Set(previousManifest.map((entry) => entry.template_id)).size !== 18) throw new Error('Baseline template IDs must be unique');
  const identityManifest = JSON.parse(await readFile(join(ROOT, 'docs/email-templates/20260924/template-manifest.json'), 'utf8'));
  const sourceBytes = await readFile(join(ROOT, CARD_SOURCE));
  const sourceLines = sourceBytes.toString().split('\n');
  const lineOf = (value) => {
    const encoded = JSON.stringify(value);
    const line = sourceLines.findIndex((text) => text.includes(encoded));
    if (line < 0) throw new Error('Source provenance line is missing');
    return line + 1;
  };
  const manifest = [], provenance = [], outputs = [];
  for (let day = 1; day <= 18; day++) {
    const stem = `day-${String(day).padStart(2, '0')}`;
    const entry = copy.days.find((candidate) => candidate.day === day);
    const previous = previousManifest.find((record) => record.day === day);
    const html = await readFile(join(CARD_BASE_DIR, `${stem}.html`), 'utf8');
    const text = await readFile(join(CARD_BASE_DIR, `${stem}.txt`), 'utf8');
    const identity = identityManifest.find((record) => record.alias === DAILY_TEMPLATE_ALIASES[day]);
    const templateId = identity?.metadata_before.match(/^ID: ([\da-f-]+)$/m)?.[1];
    if (previous.alias !== DAILY_TEMPLATE_ALIASES[day] || previous.subject !== getDailyEmailSubject(day) || previous.template_id !== templateId || previous.html_sha256 !== sha256(html) || previous.text_sha256 !== sha256(text)) throw new Error(`Day ${day}: baseline or template identity does not match immutable manifest`);
    const revised = reviseCardAlignedTemplate({ html, text, day, copy });
    outputs.push([`${stem}.html`, revised.html], [`${stem}.txt`, revised.text]);
    manifest.push({ day, alias: previous.alias, template_id: previous.template_id, template_identity_source: previous.template_identity_source, subject: previous.subject, html: `${stem}.html`, html_sha256: sha256(revised.html), text: `${stem}.txt`, text_sha256: sha256(revised.text), previous_snapshot: '20261005', previous_html_sha256: sha256(html), previous_text_sha256: sha256(text), hero_url: previous.hero_url, blog_url: previous.blog_url, card_source: CARD_SOURCE, card_source_sha256: sha256(sourceBytes), provenance: 'source-provenance.json' });
    provenance.push({ day, title: entry.title, phase: entry.phase, website_phase: DAY_DATA.find((record) => record.day === day).phase, alias: previous.alias, template_id: previous.template_id, source: CARD_SOURCE, source_sha256: sha256(sourceBytes), subtitle: { selector: `DAY_DATA.find(day === ${day}).description`, line: lineOf(entry.subtitle), value: entry.subtitle }, paragraph: { selector: `DAY_DETAILS[${day}].paragraph`, line: lineOf(entry.paragraph), value: entry.paragraph }, bullets: entry.bullets.map((value, index) => ({ selector: `DAY_DETAILS[${day}].bullets[${index}]`, line: lineOf(value), value })), question: { source: 'copy.json', selector: `days.find(day === ${day}).question`, value: entry.question, relationship: 'New reader question; not presented as verbatim website text' } });
  }
  outputs.push(['template-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`], ['source-provenance.json', `${JSON.stringify(provenance, null, 2)}\n`], ['preview.html', previewHtml(copy, outputs)]);
  if (!check) await mkdir(outputDirectory, { recursive: true });
  const names = await readdir(outputDirectory);
  if (names.some((name) => /^day-.*\.(?:html|txt)$/.test(name) && !outputs.some(([expected]) => expected === name))) throw new Error('Unexpected extra day output identity');
  for (const [name, content] of outputs) {
    const path = join(outputDirectory, name);
    if (check) {
      if (await readFile(path, 'utf8') !== content) throw new Error(`Generated file is stale: ${name}`);
    } else await writeFile(path, content);
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some((argument) => argument !== '--check')) throw new Error('Only --check is supported');
  const check = process.argv.includes('--check');
  const manifest = await generateCardAlignedMailers({ check });
  console.log(`${check ? 'Verified' : 'Generated'} ${manifest.length} exact-card HTML/text pairs, provenance and local preview. No live changes.`);
}
