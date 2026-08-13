import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "affiliate.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");
const applicationJs = readFileSync(join(root, "js/affiliate-application.js"), "utf8");

const editorialMain = html
  .slice(html.indexOf('<main id="main-content"'), html.indexOf("</main>"))
  .replace(/<form[\s\S]*?<\/form>/, "");

test("public affiliate page keeps success and error states semantically hidden", () => {
  assert.match(
    html,
    /<div id="affiliate-public-success" class="affiliate-public__success" hidden>/,
  );
  assert.match(
    html,
    /<p id="affiliate-public-error" class="affiliate-public__error" role="alert" hidden><\/p>/,
  );
  assert.match(html, /<form id="affiliate-public-form" class="affiliate-public__form" novalidate>/);
});

test("affiliate public CSS scopes [hidden] so display:grid cannot leak the success state", () => {
  const publicSection = css.slice(css.indexOf("Public Affiliate application"));
  assert.match(publicSection, /\.affiliate-public \[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.doesNotMatch(css, /(?:^|\n)\[hidden\]\s*\{/);
  assert.match(publicSection, /\.affiliate-public__form\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(publicSection, /\.affiliate-public__success\s*\{[\s\S]*?display:\s*grid;/);
});

test("public affiliate page remains an anonymous invitation without auth detection", () => {
  assert.match(html, /<script type="module" src="\/js\/affiliate-application\.js"><\/script>/);
  assert.doesNotMatch(html, /whoami|supabase|localStorage|session|login|auth/i);
  assert.doesNotMatch(html, /What you're sharing|A journal built around noticing\./);
  assert.equal((html.match(/No SineDay account is required/g) || []).length, 1);
});

test("public affiliate editorial copy keeps program terms and journal identity", () => {
  assert.match(editorialMain, /18-day personal wave/);
  assert.match(editorialMain, /SineDuck/);
  assert.match(editorialMain, /doesn't predict the future/);
  assert.match(editorialMain, /choose your Affiliate Code/);
  assert.match(editorialMain, /sharing link and approved SineDay assets/);
  assert.match(editorialMain, /secure payout setup through Stripe/);
  assert.match(editorialMain, /receive Premium while your Affiliate account is active/);
  assert.match(editorialMain, /earn \$1 from each eligible, successful monthly renewal/);
  assert.match(editorialMain, /href="\/affiliate-terms\.html">Affiliate Terms<\/a>/);
  assert.match(editorialMain, /<h3 tabindex="-1">Application received<\/h3>/);
  assert.doesNotMatch(editorialMain, /Application accepted|You're in|Welcome to the Affiliate Program/);
});

test("public affiliate form field contract is unchanged", () => {
  for (const field of [
    'id="affiliate-public-name" name="displayName"',
    'id="affiliate-public-email" name="email"',
    'id="affiliate-public-instagram" name="instagram"',
    'id="affiliate-public-tiktok" name="tiktok"',
    'id="affiliate-public-youtube" name="youtube"',
    'id="affiliate-public-website" name="website"',
    'id="affiliate-public-other" name="otherSocial"',
    'id="affiliate-public-intro" name="introduction"',
  ]) {
    assert.match(html, new RegExp(field));
  }
  assert.match(html, /At least one social, profile, or website field is required\./);
});

test("affiliate application script still reveals success only after a successful POST", () => {
  assert.match(applicationJs, /fetch\("\/api\/affiliate\/application"/);
  assert.match(applicationJs, /if \(!response\.ok \|\| !result\.ok\)/);
  assert.match(applicationJs, /showSuccess\(\{ form, successEl \}\)/);
  assert.match(applicationJs, /form\.hidden = true/);
  assert.match(applicationJs, /successEl\.hidden = false/);
  assert.match(applicationJs, /heading\?\.focus\?\.\(\)/);
});
