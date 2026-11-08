import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('llms.txt');
const origin = 'https://www.sineday.app';

test('llms guide is concise public Markdown with accurate product boundaries', () => {
  assert.match(guide, /^# SineDay\n\n> /);
  assert.ok(guide.length < 3000);
  assert.match(guide, /Journal, History and Print require Premium/);
  assert.match(guide, /https:\/\/www\.sineday\.blog\//);
  assert.doesNotMatch(guide, /https:\/\/sineday\.app|\/dashboard|\/login|\/auth\/|\/api\//);
  const links = [...guide.matchAll(/\]\((https:[^)]+)\)/g)].map(match => new URL(match[1]));
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.ok([origin, 'https://www.sineday.blog'].includes(link.origin));
    if (link.origin !== origin) continue;
    const file = link.pathname === '/' ? 'index.html' : link.pathname === '/daily' ? 'daily.html' : link.pathname.slice(1);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});

test('guide has a sitemap URL and standard homepage discovery without changing crawler rules', () => {
  const locations = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(locations.filter(url => url === `${origin}/llms.txt`).length, 1);
  assert.match(read('index.html'), /<link rel="describedby" href="https:\/\/www\.sineday\.app\/llms\.txt" type="text\/plain">/);
  assert.doesNotMatch(read('robots.txt'), /^Sitemap:.*llms\.txt/m);
  assert.doesNotMatch(read('robots.txt'), /Disallow:.*llms/);
});
