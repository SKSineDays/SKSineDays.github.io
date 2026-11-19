import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../'+p, import.meta.url));
const html = read('login.html').toString();
const js = read('js/account-registration.js').toString();
test('post-eligibility Google is an empty SDK mount, not a proxy button', () => {
  assert.match(html, /<div id="registration-google-button"><\/div>/);
  assert.match(js, /google\.accounts\.id\.renderButton\(document\.getElementById\('registration-google-button'\),\s*\{[^}]*theme: 'filled_black'[^}]*shape: 'pill'[^}]*text: 'continue_with'/);
  assert.doesNotMatch(html, /#registration-google-button\s+iframe/);
});
test('Apple controls retain native buttons and share the official local artwork', () => {
  for (const id of ['apple-signin-btn','registration-apple-button']) {
    const button = html.match(new RegExp('<button id="'+id+'"[^>]*>[\\s\\S]*?</button>'))?.[0];
    assert.match(button, /type="button"/);
    assert.match(button, /src="\/assets\/brand\/continue-with-apple\.png"[^>]*alt="Continue with Apple"/);
  }
  const png=read('assets/brand/continue-with-apple.png');
  assert.equal(png.readUInt32BE(16),420); assert.equal(png.readUInt32BE(20),96);
});
