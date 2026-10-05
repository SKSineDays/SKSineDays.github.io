import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DAY_DATA, DAY_DETAILS } from '../js/sineday-engine.js';
import { CARD_BASE_DIR, CARD_ALIGNED_DIR, validateCardAlignedCopy, validateIdentities, generateCardAlignedMailers, reviseCardAlignedTemplate } from '../scripts/generate-card-aligned-mailers.mjs';
import { generateDailyEditorialCopy } from '../scripts/generate-daily-editorial-copy.mjs';
import { generateDailyEmailCopy } from '../scripts/generate-daily-email-copy.mjs';
import { DAILY_TEMPLATE_ALIASES, DAILY_SINEDAY_TITLES, getDailyEmailSubject } from '../api/_lib/daily-email.js';
import { validateDailyTemplate } from '../scripts/audit-daily-email-templates.mjs';
const copy = JSON.parse(readFileSync(join(CARD_ALIGNED_DIR, 'copy.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(CARD_ALIGNED_DIR, 'template-manifest.json'), 'utf8'));
const provenance = JSON.parse(readFileSync(join(CARD_ALIGNED_DIR, 'source-provenance.json'), 'utf8'));
const originalManifest = JSON.parse(readFileSync(join(CARD_BASE_DIR, 'template-manifest.json'), 'utf8'));
const read = (dir, day, ext) => readFileSync(join(dir, `day-${String(day).padStart(2, '0')}.${ext}`), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = readFileSync(new URL('../js/sineday-engine.js', import.meta.url), 'utf8');
const decoded = (value) => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const section = (name) => new RegExp(`<tr><td data-sineday-surface="${name}"[^>]*>[\\s\\S]*?<\\/td><\\/tr>`, 'g');
const bodyPattern = /(<p style="[^>]*font-size:17px;line-height:1\.65;color:#E8ECF7;">)[^<]*(<\/p>)/g;
function visibleHtml(html) {
  return normalize(decoded(html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<p\b[^>]*style="display:none;[^>]*>[\s\S]*?<\/p>/, '').replace(/<(?:\/?(?:p|h[1-6]|td|tr|table|ul|li)|br)\b[^>]*>/g, ' ').replace(/<[^>]+>/g, '')));
}
function visibleText(text) {
  return normalize(text.replace(/^• /gm, '').replace(/ \((?:https:\/\/sineday\.app\/dashboard\.html|https:\/\/www\.sineday\.blog\/|\{\{\{OPT_OUT_URL\}\}\})\)/g, ''));
}
function protectedHtml(html, baseline) {
  let bodyIndex = 0;
  return html.replace(/(<p style="display:none;[^>]*>)[^<]*(<\/p>)/, '$1[preheader]$2')
    .replace(/(<p style="[^>]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^>]*>)[^<]*(<\/p>)/, '$1[subtitle]$2')
    .replace(bodyPattern, (_all, open, close) => bodyIndex++ === 0 ? `${open}[body]${close}` : baseline ? '' : '[UNEXPECTED SECOND BODY]')
    .replace(section('notice'), (block) => baseline ? block.replace(/<p style="[^>]*font-size:18px;[^>]*>[^<]*<\/p>/, '[notice-list]') : block.replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/, '[notice-list]'))
    .replace(section('reflection'), (block) => block.replace(/(<h2\b[^>]*>)[^<]*(<\/h2>)/, '$1[question]$2').replace(/<p style="[^>]*font-size:15px;line-height:1\.65;color:#B7C2D9;">[^<]*<\/p>/, baseline ? '' : '[UNEXPECTED CAVEAT]'));
}
function protectedText(text, baseline) {
  const blocks = text.split('\n\n');
  const editable = baseline ? [2, 3, 6, 8] : [2, 3, 5, 7];
  return blocks.flatMap((value, index) => baseline && [4, 9].includes(index) ? [] : [editable.includes(index) ? '[editable]' : value]).join('\n\n');
}

test('all 18 identities, website matches and deterministic generated artifacts are complete', async () => {
  assert.equal(validateCardAlignedCopy(copy), copy);
  assert.deepEqual(copy.days.map((entry) => entry.day).sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(readdirSync(CARD_ALIGNED_DIR).filter((name) => /^day-\d{2}\.html$/.test(name)).length, 18);
  assert.equal(readdirSync(CARD_ALIGNED_DIR).filter((name) => /^day-\d{2}\.txt$/.test(name)).length, 18);
  assert.deepEqual(await generateCardAlignedMailers({ check: true }), manifest);
  assert.equal((await generateDailyEditorialCopy({ check: true })).length, 18);
  assert.equal((await generateDailyEmailCopy({ check: true })).length, 18);
});

for (let day = 1; day <= 18; day++) {
  test(`Day ${day}: exact card source, question, provenance, parity and byte-exact shell`, () => {
    const entry = copy.days.find((entry) => entry.day === day);
    const data = DAY_DATA.find((entry) => entry.day === day);
    const detail = DAY_DETAILS[day];
    const html = read(CARD_ALIGNED_DIR, day, 'html'), text = read(CARD_ALIGNED_DIR, day, 'txt');
    const baselineHtml = read(CARD_BASE_DIR, day, 'html'), baselineText = read(CARD_BASE_DIR, day, 'txt');
    const record = manifest.find((entry) => entry.day === day), previous = originalManifest.find((entry) => entry.day === day);
    const proof = provenance.find((entry) => entry.day === day);
    assert.equal(entry.subtitle, data.description);
    assert.equal(entry.paragraph, detail.paragraph);
    assert.deepEqual(entry.bullets, detail.bullets);
    assert.equal(entry.title.toUpperCase(), data.phase.split(' • ')[1]);
    assert.equal(entry.phase.toUpperCase(), data.phase.split(' • ')[0]);
    assert.equal(record.alias, DAILY_TEMPLATE_ALIASES[day]);
    assert.equal(record.subject, getDailyEmailSubject(day));
    assert.equal(record.template_id, previous.template_id);
    assert.equal(record.template_identity_source, previous.template_identity_source);
    assert.equal(record.previous_snapshot, '20261005');
    assert.equal(record.html_sha256, hash(html)); assert.equal(record.text_sha256, hash(text));
    assert.equal(record.previous_html_sha256, hash(baselineHtml)); assert.equal(record.previous_text_sha256, hash(baselineText));
    assert.equal(record.card_source_sha256, hash(source)); assert.equal(proof.source_sha256, hash(source));
    assert.equal(proof.website_phase, data.phase);
    assert.equal(proof.template_id, previous.template_id);
    assert.equal(proof.alias, previous.alias);
    for (const field of [proof.subtitle, proof.paragraph, ...proof.bullets]) assert.ok(source.split('\n')[field.line - 1].includes(JSON.stringify(field.value)), `Source provenance line ${field.line}`);
    assert.equal(proof.question.value, entry.question);
    assert.equal(proof.question.source, 'copy.json');
    assert.deepEqual(validateDailyTemplate({ ...record, html, status: 'published' }, day, record.alias), []);
    assert.equal(visibleHtml(html), visibleText(text), 'Complete visible HTML and TXT parity');
    assert.equal(protectedHtml(html, false), protectedHtml(baselineHtml, true), 'Every byte outside explicitly authorized surfaces is unchanged');
    assert.equal(protectedText(text, false), protectedText(baselineText, true), 'Protected plain text is byte-exact');
    assert.deepEqual(html.match(/<img\b[^>]*>/g), baselineHtml.match(/<img\b[^>]*>/g));
    assert.deepEqual(html.match(/href="[^"]*"/g), baselineHtml.match(/href="[^"]*"/g));
    assert.deepEqual(html.match(/\{\{\{[^}]+\}\}\}/g), baselineHtml.match(/\{\{\{[^}]+\}\}\}/g));
    assert.deepEqual(text.match(/\{\{\{[^}]+\}\}\}/g), baselineText.match(/\{\{\{[^}]+\}\}\}/g));
    for (const name of ['blog', 'footer']) assert.deepEqual(html.match(section(name)), baselineHtml.match(section(name)));
    assert.equal((html.match(bodyPattern) || []).length, 1);
    const notice = html.match(section('notice'))[0];
    assert.equal((notice.match(/<ul\b/g) || []).length, 1);
    const bulletMatches = [...notice.matchAll(/<li\b[^>]*>([^<]*)<\/li>/g)];
    assert.deepEqual(bulletMatches.map((match) => decoded(match[1])), detail.bullets);
    for (const match of bulletMatches) {
      assert.match(match[0], /<li style="[^"]*font-family:Arial, Helvetica, sans-serif;font-size:18px;line-height:1\.65;color:#E8ECF7;">/, 'Each list item explicitly carries its existing typography for the template service contract');
    }
    const reflection = html.match(section('reflection'))[0];
    assert.equal(decoded(reflection.match(/<h2\b[^>]*>([^<]*)<\/h2>/)[1]), entry.question);
    assert.equal((reflection.match(/\?/g) || []).length, 1);
    assert.doesNotMatch(reflection, /Your writing|fiction|made up|Write about|font-size:15px/);
    assert.doesNotMatch(html, /<(?:style|script|form|input|iframe|object|embed)\b|\bon\w+\s*=|(?:javascript|vbscript):|utm_|[?&](?:email|user|token)=/i);
    const blocks = text.split('\n\n');
    assert.equal(blocks[1], DAILY_SINEDAY_TITLES[day]);
    assert.equal(blocks[2], data.description); assert.equal(blocks[3], detail.paragraph);
    assert.equal(blocks[4], 'Notice today'); assert.equal(blocks[5], detail.bullets.map((value) => `• ${value}`).join('\n'));
    assert.equal(blocks[6], 'Your Sine, through your eyes'); assert.equal(blocks[7], entry.question);
    assert.equal(blocks[8], 'Reply here or email mysine@sineday.app. One sentence is enough.');
  });
}

test('fail closed on missing, extra, duplicate, malformed or mismatched identities', () => {
  const bad = (mutate, pattern) => { const changed = structuredClone(copy); mutate(changed); assert.throws(() => validateCardAlignedCopy(changed), pattern); };
  bad((value) => value.days.pop(), /18 day identities/);
  bad((value) => value.days.push(structuredClone(value.days[0])), /18 day identities/);
  bad((value) => value.days[17].day = 1, /18 day identities/);
  bad((value) => value.days[0].day = '1', /18 day identities/);
  bad((value) => value.days[17].day = 19, /18 day identities/);
  bad((value) => value.days[0].title = 'Momentum', /title differs/);
  bad((value) => value.days[0].phase = 'Trough', /phase differs/);
  bad((value) => value.days[0].subject = 'Changed', /unexpected field/);
  bad((value) => value.source = 'invented', /unsupported schema or source/);
  bad((value) => value.reflection_caveat = 'New caveat', /unexpected field/);
  assert.throws(() => validateIdentities(originalManifest.slice(1), 'Baseline manifest'), /18 day identities/);
});

test('fail closed on every subtitle, paragraph and bullet drift, without silent source replacement', () => {
  for (let index = 0; index < 18; index++) {
    for (const key of ['subtitle', 'paragraph']) {
      const changed = structuredClone(copy); changed.days[index][key] += ' Added';
      assert.throws(() => validateCardAlignedCopy(changed), /differs from exact website source/);
    }
    for (const mutation of [(entry) => entry.bullets.pop(), (entry) => entry.bullets.push('Extra'), (entry) => entry.bullets.reverse(), (entry) => entry.bullets[0] += ' Added']) {
      const changed = structuredClone(copy); mutation(changed.days[index]);
      assert.throws(() => validateCardAlignedCopy(changed), /bullets differ/);
    }
  }
});

test('reflection rejects assignments, fiction caveats, nonquestions, generic duplicates and new variables', () => {
  for (const question of ['Write about your day.', 'What would you write about your wave?', 'Can you imagine a scene from your wave?', 'How would you describe your wave?', 'What is your story?', 'What is your fictional character feeling?', 'Your day is beginning.', 'What is your next step? Why?', 'What comes next?', 'What is your {{{NEW_VARIABLE}}}?', 'What is your <img src=x>?', 'What is your\nnext step?']) {
    const changed = structuredClone(copy); changed.days[0].question = question;
    assert.throws(() => validateCardAlignedCopy(changed), /question|assignment|variables|single-line/);
  }
  const changed = structuredClone(copy); changed.days[1].question = changed.days[0].question;
  assert.throws(() => validateCardAlignedCopy(changed), /distinct reader question/);
});

test('missing/duplicated input targets, caveat drift and wrong day cannot be silently generated', () => {
  const html = read(CARD_BASE_DIR, 1, 'html'), text = read(CARD_BASE_DIR, 1, 'txt');
  for (const pattern of [/<p style="display:none;[^>]*>[^<]*<\/p>/, /<p style="[^>]*font-family:Georgia, Times New Roman, serif;font-size:17px;[^>]*>[^<]*<\/p>/, bodyPattern, section('notice'), section('reflection')]) {
    const target = [...html.matchAll(new RegExp(pattern.source, 'g'))][0][0];
    for (const altered of [html.replace(target, ''), html + target]) assert.throws(() => reviseCardAlignedTemplate({ html: altered, text, day: 1, copy }), /matching section/);
  }
  const reflection = html.match(section('reflection'))[0];
  for (const pattern of [/<h2\b[^>]*>[^<]*<\/h2>/, /<p style="[^>]*font-size:15px;[^>]*>[^<]*<\/p>/]) {
    const target = reflection.match(pattern)[0];
    for (const value of [reflection.replace(target, ''), reflection.replace(target, () => target + target)]) assert.throws(() => reviseCardAlignedTemplate({ html: html.replace(reflection, () => value), text, day: 1, copy }), /matching section/);
  }
  for (const index of [2, 3, 4, 6, 8, 9]) {
    const target = text.split('\n\n')[index];
    for (const value of [text.replace(target, 'Missing sentinel'), text + `\n${target}\n\n`]) assert.throws(() => reviseCardAlignedTemplate({ html, text: value, day: 1, copy }), /text .*matching section/);
  }
  assert.throws(() => reviseCardAlignedTemplate({ html: html.replace('Your writing can come from life or be entirely made up.', 'Something else.'), text, day: 1, copy }), /unexpected baseline caveat/);
  assert.throws(() => reviseCardAlignedTemplate({ html, text, day: 2, copy }), /source identity mismatch/);
});

test('new question text is HTML-escaped and dollar replacement tokens remain literal', () => {
  const changed = structuredClone(copy); changed.days[0].question = 'What do you notice about $& $` $\' & "quotes" in your wave?';
  const revised = reviseCardAlignedTemplate({ html: read(CARD_BASE_DIR, 1, 'html'), text: read(CARD_BASE_DIR, 1, 'txt'), day: 1, copy: changed });
  assert.ok(revised.html.includes('$&amp; $` $&#39; &amp; &quot;quotes&quot;'));
  assert.ok(revised.text.includes(changed.days[0].question));
  assert.equal(visibleHtml(revised.html), visibleText(revised.text));
});

test('stale artifact, stale provenance and extra output identities are detected without repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sineday-card-check-'));
  try {
    await writeFile(join(directory, 'copy.json'), JSON.stringify(copy));
    await generateCardAlignedMailers({ outputDirectory: directory });
    await generateCardAlignedMailers({ outputDirectory: directory, check: true });
    await writeFile(join(directory, 'source-provenance.json'), 'stale sentinel');
    await assert.rejects(generateCardAlignedMailers({ outputDirectory: directory, check: true }), /Generated file is stale: source-provenance.json/);
    assert.equal(await readFile(join(directory, 'source-provenance.json'), 'utf8'), 'stale sentinel');
    await generateCardAlignedMailers({ outputDirectory: directory });
    await writeFile(join(directory, 'day-01.html'), 'stale HTML');
    await assert.rejects(generateCardAlignedMailers({ outputDirectory: directory, check: true }), /Generated file is stale: day-01.html/);
    assert.equal(await readFile(join(directory, 'day-01.html'), 'utf8'), 'stale HTML');
    await generateCardAlignedMailers({ outputDirectory: directory });
    await writeFile(join(directory, 'day-19.html'), 'extra');
    await assert.rejects(generateCardAlignedMailers({ outputDirectory: directory, check: true }), /extra day output identity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
