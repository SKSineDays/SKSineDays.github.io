import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('daily form explicitly honors hidden over author grid/flex rules', async () => {
  const css = await readFile(new URL('../css/daily.css', import.meta.url),'utf8');
  const html = await readFile(new URL('../daily.html', import.meta.url),'utf8');
  assert.match(css,/\.daily-form\s+\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/);
  assert.match(html,/<form[^>]+class="daily-form"/);
  assert.match(html,/class="daily-field" data-email-step hidden/);
  assert.match(html,/class="daily-consent" data-email-step hidden/);
});
