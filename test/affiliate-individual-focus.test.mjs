import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { AffiliateUI, AFFILIATE_DISCLOSURE } from '../js/affiliate-ui.js';
import { validateAffiliateApplicationInput } from '../api/_lib/affiliate-server.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const view = Object.assign(Object.create(AffiliateUI.prototype), {
  status: { viewerEmail: 'creator@example.test' }, mount: { innerHTML: '' }, supportCard: () => '', assets: [],
});
view.renderAffiliateApplication();
for (const [name, html, prefix] of [
  ['public', read('affiliate.html'), 'affiliate-public'],
  ['signed-in', view.mount.innerHTML, 'affiliate-applicant'],
]) {
  test(`${name} invitation focuses on individuals and creators with accessible application guidance`, () => {
    assert.match(html, /Individuals and creators/);
    assert.doesNotMatch(html, /\bPTAs?\b|\bPTSA\b|fundrais|group application|group field|group representative|authority to act for the group/i);
    assert.match(html, /Another profile or website/);
    assert.ok(html.includes(`aria-describedby="${prefix}-name-help"`));
    assert.ok(html.includes(`aria-describedby="${prefix}-intro-help`));
    assert.match(html, /applications are reviewed|application is reviewed/i);
  });
}

test('one share kit retains creator copy, disclosure, artwork and account referral link without group selection', () => {
  const html = view.renderShare({ code: 'SAMPLE', affiliateUrl: 'https://www.sineday.app/?ref=SAMPLE' });
  assert.match(html, /Copy full post/);
  assert.match(html, /Choose your image/);
  assert.ok(html.includes(AFFILIATE_DISCLOSURE));
  assert.ok(html.includes('https://www.sineday.app/?ref=SAMPLE'));
  assert.doesNotMatch(html, /data-affiliate-kit|group-kit|PTA|fundrais|group affiliate/i);
});

test('retired group artwork, generators and client flows are absent', () => {
  for (const path of ['assets/affiliate/groups/assets.json', 'assets/affiliate/groups/pta/READ-FIRST.txt', 'scripts/generate-group-affiliate-assets.mjs']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  for (const path of ['js/affiliate-ui.js', 'css/dashboard.css', 'package.json', '.github/workflows/affiliate-dashboard.yml']) {
    assert.doesNotMatch(read(path), /groupAffiliateTemplates|loadGroupAssets|affiliate-group-|generate-group-affiliate-assets|check:group-affiliate-assets/);
  }
});

test('cleanup preserves existing free-text application records and validation rather than deleting or reclassifying applicants', () => {
  const fields = { displayName: 'Sample Representative', email: 'representative@example.test', otherSocial: 'Existing Community', introduction: 'An existing application supplied a community name in this free-text field.' };
  const result = validateAffiliateApplicationInput(fields);
  assert.equal(result.ok, true);
  assert.equal(result.fields.otherSocial, fields.otherSocial);
  assert.equal(result.fields.introduction, fields.introduction);
  assert.equal(validateAffiliateApplicationInput({ ...fields, otherSocial: '' }).ok, false);
});
