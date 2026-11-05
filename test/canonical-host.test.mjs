import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const origin = 'https://www.sineday.app';
const publicPages = new Map([
  ['index.html', '/'],
  ['accessibility.html', '/accessibility.html'],
  ['terms.html', '/terms.html'],
  ['refunds.html', '/refunds.html'],
  ['privacy.html', '/privacy.html'],
  ['contact.html', '/contact.html'],
  ['affiliate.html', '/affiliate.html'],
  ['daily.html', '/daily'],
]);
const canonicalPages = new Map([
  ...publicPages,
  ['affiliate-terms.html', '/affiliate-terms.html'],
  ['login.html', '/login.html'],
  ['dashboard.html', '/dashboard.html'],
]);

test('all existing page canonicals use the live www origin without changing routes', () => {
  for (const [file, path] of canonicalPages) {
    const links = [...read(file).matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)];
    assert.equal(links.length, 1, `${file} must have exactly one canonical`);
    assert.equal(links[0][0].match(/\bhref="([^"]+)"/i)?.[1], `${origin}${path}`, file);
  }
  for (const file of readdirSync(new URL('../', import.meta.url)).filter(file => file.endsWith('.html'))) {
    const head = read(file).split(/<\/head>/i)[0];
    assert.doesNotMatch(head, /https:\/\/sineday\.app(?:[\/"\s]|$)/i, `${file} head must not point to the redirecting origin`);
  }
});

test('sitemap keeps the same eight public routes, each matching its page canonical', () => {
  const locations = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
  assert.deepEqual(locations, [...publicPages.values()].map(path => `${origin}${path}`));
  assert.equal(new Set(locations).size, locations.length, 'Sitemap must not contain duplicate URLs');
  for (const [file, path] of publicPages) {
    assert.ok(read(file).includes(`rel="canonical" href="${origin}${path}"`), file);
    assert.doesNotMatch(read(file), /<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i, file);
  }
});

test('robots advertises the www sitemap and retains all existing private exclusions', () => {
  assert.deepEqual(read('robots.txt').trim().split(/\r?\n/), [
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard.html',
    'Disallow: /login.html',
    'Disallow: /auth/',
    `Sitemap: ${origin}/sitemap.xml`,
  ]);
});

test('social and structured-data URLs agree with page canonicals', () => {
  for (const file of ['index.html', 'affiliate.html']) {
    const html = read(file);
    assert.equal(html.match(/<meta property="og:url" content="([^"]+)"/)[1], `${origin}${canonicalPages.get(file)}`);
    assert.equal(html.match(/<meta property="og:image" content="([^"]+)"/)[1], `${origin}/assets/og-hero.png`);
  }
  const home = read('index.html');
  assert.equal(home.match(/<meta name="twitter:image" content="([^"]+)"/)[1], `${origin}/assets/og-hero.png`);
  const schema = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema.url, `${origin}/`);
  assert.equal(schema['@type'], 'WebApplication');
});

test('private pages and confirmation routes retain crawler protections', () => {
  for (const file of ['login.html', 'dashboard.html', 'auth/callback.html', 'unsubscribe.html', 'daily-confirm.html']) {
    assert.match(read(file), /<meta name="robots" content="noindex, nofollow(?:, noarchive)?">/, file);
    assert.ok(!read('sitemap.xml').includes(`/${file}`), `${file} must stay out of the sitemap`);
  }
  assert.ok(!read('sitemap.xml').includes('/daily/confirm'));
  const config = JSON.parse(read('vercel.json'));
  assert.deepEqual(config.rewrites, [
    { source: '/daily', destination: '/daily.html' },
    { source: '/daily/confirm', destination: '/daily-confirm.html' },
  ]);
  for (const path of ['/daily/confirm', '/daily-confirm.html']) {
    const headers = config.headers.find(entry => entry.source === path)?.headers;
    assert.ok(headers?.some(header => header.key === 'X-Robots-Tag' && header.value === 'noindex, nofollow, noarchive'), path);
  }
});
