import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AffiliateUI, AFFILIATE_DISCLOSURE, affiliateShareText } from "../js/affiliate-ui.js";

const affiliate = { status: "active", displayName: "Sample Creator", code: "SAMPLE", affiliateUrl: "https://www.sineday.app/?ref=SAMPLE", payoutsEnabled: true };
function ui() {
  return Object.assign(Object.create(AffiliateUI.prototype), {
    status: { affiliate }, summary: { summary: {}, monthly: [], payouts: [] }, assets: [],
    abortController: new AbortController(), entitlement: { affiliateStatus: "active" },
    mount: { innerHTML: "" }, activeTab: "overview", pendingActions: new Set(),
  });
}

test("every ready-to-share message includes disclosure, code, qualified discount, and one link", () => {
  const post = affiliateShareText(affiliate);
  assert.ok(post.startsWith(AFFILIATE_DISCLOSURE));
  assert.match(post, /SAMPLE/);
  assert.match(post, /while the promotion remains valid/);
  assert.equal(post.split(affiliate.affiliateUrl).length, 2);
  assert.ok(!affiliateShareText(affiliate, { includeUrl: false }).includes(affiliate.affiliateUrl));
});

test("summary failure preserves the active share kit without displaying false zero balances", async () => {
  const view = ui();
  view.request = async (path) => {
    if (path.endsWith("/status")) return { affiliate };
    throw new Error("Earnings unavailable");
  };
  view.loadAssets = async () => { view.assets = [{ path: "/assets/affiliate/example.png" }]; };
  await view.loadStatus();
  assert.equal(view.status.affiliate.status, "active");
  assert.equal(view.summary, null);
  assert.equal(view.assets.length, 1);
  assert.match(view.renderOverview(), /temporarily unavailable/);
  assert.doesNotMatch(view.renderOverview(), /\$0\.00/);
  assert.match(view.renderShare(affiliate), /Copy full post/);
  assert.match(view.renderPayouts(affiliate), /Manage payout & tax details/);
  assert.doesNotMatch(view.renderPayouts(affiliate), /\$0\.00/);
});

test("assets accept only approved local image paths and have a clear retry state", async (t) => {
  const view = ui();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { path: "/assets/affiliate/square.png" }, { path: "https://example.com/evil.png" },
    { path: "/assets/affiliate/../secret.png" }, { path: "/assets/affiliate/unsafe.html" },
  ] });
  await view.loadAssets();
  assert.deepEqual(view.assets, [{ path: "/assets/affiliate/square.png" }]);
  globalThis.fetch = async () => ({ ok: false });
  await view.loadAssets();
  assert.equal(view.assetsError, true);
  assert.match(view.renderShare(affiliate), /Retry images/);
  assert.match(view.renderShare(affiliate), /Copy full post/);
});

test("zero earnings show an honest empty state instead of decorative nonzero bars", () => {
  const view = ui();
  view.summary.monthly = [{ month: "2026-11", earnedCents: 0, supporterCount: 0 }];
  assert.match(view.renderOverview(), /No eligible commissions yet/);
  assert.doesNotMatch(view.renderOverview(), /affiliate-chart__bar/);
  view.summary.monthly.push({ month: "2026-12", earnedCents: 100, supporterCount: 1 });
  assert.match(view.renderOverview(), /--affiliate-bar-height:0%/);
});

test("dashboard escapes dynamic profile, caption, and asset fields", () => {
  const view = ui();
  view.assets = [{ path: "/assets/affiliate/square.png", title: '<img onerror="x">', usage: '<script>x</script>' }];
  view.renderActive({ ...affiliate, displayName: "<script>bad()</script>", code: 'TEST"<', affiliateUrl: '</textarea><script>bad()</script>' });
  assert.doesNotMatch(view.mount.innerHTML, /<script>|onerror="x"/);
  assert.match(view.mount.innerHTML, /&lt;script&gt;/);
});

test("asset manifest files exist at their published dimensions and SVG wordmark is standalone", async () => {
  const manifest = JSON.parse(await readFile(new URL("../assets/affiliate/assets.json", import.meta.url)));
  assert.equal(manifest.filter((asset) => asset.format === "PNG").length, 3);
  for (const asset of manifest) {
    const bytes = await readFile(new URL(`..${asset.path}`, import.meta.url));
    assert.ok(bytes.length > 100);
    if (asset.format === "PNG") {
      assert.equal(bytes.toString("ascii", 1, 4), "PNG");
      assert.equal(bytes.readUInt32BE(16), asset.width);
      assert.equal(bytes.readUInt32BE(20), asset.height);
    } else {
      assert.doesNotMatch(bytes.toString(), /(?:href|xlink:href)=["'](?:https?:|\/)/);
    }
    assert.ok(asset.usage);
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("destroyed views ignore a late status response and entitlement callback", async () => {
  const view = ui(), response = deferred();
  const originalStatus = view.status;
  let callbacks = 0;
  view.request = () => response.promise;
  view.onEntitlementChanged = () => { callbacks++; };
  const pending = view.loadStatus();
  view.destroyed = true;
  response.resolve({ affiliate: { ...affiliate, status: "onboarding" } });
  await pending;
  assert.equal(view.status, originalStatus);
  assert.equal(callbacks, 0);
});

test("destroyed views do not redirect or show late payout and refresh errors", async () => {
  for (const operation of ["openStripeRoute", "refreshStatus"]) {
    for (const fails of [true, false]) {
      const view = ui(), response = deferred();
      const messages = [];
      view.request = () => response.promise;
      view.showError = message => messages.push(message);
      view.showSuccess = message => messages.push(message);
      view.loadStatus = () => { throw new Error("A destroyed view must not fetch more status"); };
      const pending = view[operation]("/api/affiliate/login-link");
      view.destroyed = true;
      if (fails) response.reject(new Error("Late response"));
      else response.resolve({ url: "https://example.test/never-navigate" });
      await pending;
      assert.deepEqual(messages, []);
    }
  }
});

test("destroyed form submissions never navigate, refresh, or notify the next account", async (t) => {
  const OriginalFormData = globalThis.FormData;
  globalThis.FormData = class { get(name) { return name === "instagram" ? "@sample" : "sample"; } };
  t.after(() => { globalThis.FormData = OriginalFormData; });
  for (const type of ["application", "apply", "onboarding"]) {
    const view = ui(), response = deferred(), submit = { disabled: false }, messages = [];
    view.request = () => response.promise;
    view.showSuccess = message => messages.push(message);
    view.showError = message => messages.push(message);
    view.refresh = () => { throw new Error("A destroyed form must not refresh"); };
    const pending = view.handleSubmit({ target: { dataset: { affiliateForm: type }, querySelector: () => submit }, preventDefault() {} });
    assert.equal(submit.disabled, true);
    view.destroyed = true;
    response.resolve({ url: "https://example.test/never-navigate" });
    await pending;
    assert.deepEqual(messages, []);
  }
});

test("late clipboard failure cannot append a fallback into a replaced account view", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const response = deferred(), view = ui();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: () => response.promise } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else delete globalThis.navigator; });
  view.isOpen = () => true;
  const pending = view.copyText("Sample");
  view.destroyed = true;
  response.reject(new Error("Clipboard denied after account change"));
  await pending;
  assert.equal(view.mount.innerHTML, "");
});

test("tab changes align their first content below sticky controls using only the sheet scroller", (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ top: "52px", marginBottom: "22px" }) });
  t.after(() => { if (original) Object.defineProperty(globalThis, "getComputedStyle", original); else delete globalThis.getComputedStyle; });
  const view = ui();
  const scroller = { scrollTop: 600, clientTop: 0, getBoundingClientRect: () => ({ top: 100 }) };
  const tabs = { offsetHeight: 56 };
  const panel = { getBoundingClientRect: () => ({ top: -80 }) };
  view.activeTab = "payouts";
  view.sheet = { querySelector: () => scroller };
  view.mount.querySelector = selector => selector === ".affiliate-sheet__tabs" ? tabs : panel;
  view.scrollToActivePanel();
  assert.equal(scroller.scrollTop, 290);
});

test("group templates preserve one account link and disclosure without inventing donations or payment terms", async () => {
  const { groupAffiliateTemplates, GROUP_AFFILIATE_DISCLOSURE } = await import('../js/affiliate-ui.js');
  for (const pta of [false, true]) {
    const templates = groupAffiliateTemplates(affiliate, 'River Community', { pta });
    assert.equal(templates.length, pta ? 3 : 6);
    for (const template of templates) {
      assert.ok(template.text.includes('River Community'));
      assert.ok(template.text.includes(`${GROUP_AFFILIATE_DISCLOSURE}\n${affiliate.affiliateUrl}`));
      assert.equal(template.text.split(affiliate.affiliateUrl).length, 2);
      assert.match(template.text, /optional/);
      assert.doesNotMatch(template.text, /donat|tax.deduct|guaranteed|at no extra cost|every purchase|healing/i);
      if (pta) assert.match(template.text, /does not endorse, warrant or recommend/);
    }
  }
});

test("group kit is gated by local authority confirmation and separate from account eligibility", () => {
  const view = ui(); view.shareAudience = 'community'; view.groupName = '<script>bad()</script>';
  let output = view.renderShare(affiliate);
  assert.match(output, /does not enroll a group/);
  assert.doesNotMatch(output, /id="affiliate-group-caption"/);
  view.groupConfirmed = true;
  view.groupAssets = [
    { id: 'community', path: '/assets/affiliate/groups/square.png', title: 'Community' },
    { id: 'pta-information-notice', path: '/assets/affiliate/groups/pta.png', title: 'PTA notice' },
  ];
  output = view.renderShare(affiliate);
  assert.match(output, /id="affiliate-group-caption"/);
  assert.doesNotMatch(output, /<script>|<h4>PTA notice<\/h4>/);
  assert.match(output, /&lt;script&gt;/);
  view.shareAudience = 'pta';
  output = view.renderShare(affiliate);
  assert.match(output, /<h4>PTA notice<\/h4>/);
  assert.doesNotMatch(output, /<h4>Community<\/h4>|data-group-pdf/);
});

test("group image loading rejects remote, traversal and unsupported formats without affecting personal assets", async (t) => {
  const view = ui(), originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  view.assets = [{ path: '/assets/affiliate/personal.png' }];
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { path: '/assets/affiliate/groups/good.png' }, { path: '/assets/affiliate/groups/pta/notice.png' }, { path: '/assets/affiliate/groups/../bad.png' },
    { path: '/assets/affiliate/groups/evil.html' }, { path: 'https://example.test/bad.png' },
  ] });
  await view.loadGroupAssets();
  assert.deepEqual(view.groupAssets, [{ path: '/assets/affiliate/groups/good.png' }, { path: '/assets/affiliate/groups/pta/notice.png' }]);
  assert.equal(view.assets.length, 1);
  globalThis.fetch = async () => ({ ok: false });
  await view.loadGroupAssets();
  assert.equal(view.groupAssetsError, true);
  assert.equal(view.assets.length, 1);
});

test("inactive account refresh clears local group authority and copy identity", async () => {
  const view = ui(); view.groupConfirmed = true; view.groupName = 'River Community';
  view.request = async () => ({ affiliate: { ...affiliate, status: 'paused' } });
  await view.loadStatus();
  assert.equal(view.groupConfirmed, false);
  assert.equal(view.groupName, '');
});


test("PTA opens as a distinct kit folder with immediate qualified guidance", () => {
  const view = ui(); view.shareAudience = 'pta';
  const html = view.renderShare(affiliate);
  assert.match(html, /data-affiliate-kit="pta" aria-pressed="true"/);
  assert.match(html, /Please read before sharing/);
  assert.match(html, /Policies and approved arrangements vary/);
  assert.match(html, /not a blanket prohibition/);
  assert.match(html, /groups\/pta\/READ-FIRST.txt/);
  assert.doesNotMatch(html, /id="affiliate-group-caption"/);
});
