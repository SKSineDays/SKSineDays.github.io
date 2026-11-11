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
