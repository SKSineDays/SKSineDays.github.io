import test from "node:test";
import assert from "node:assert/strict";

test("Affiliate UI imports cleanly so dashboard boot is not blocked", async () => {
  const module = await import("../js/affiliate-ui.js");
  assert.equal(typeof module.AffiliateUI, "function");
});
