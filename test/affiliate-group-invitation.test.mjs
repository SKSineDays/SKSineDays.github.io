import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AffiliateUI } from "../js/affiliate-ui.js";
import { validateAffiliateApplicationInput } from "../api/_lib/affiliate-server.js";

const publicHtml = readFileSync(new URL("../affiliate.html", import.meta.url), "utf8");
const view = Object.assign(Object.create(AffiliateUI.prototype), {
  status: { viewerEmail: "representative@example.test" },
  mount: { innerHTML: "" },
  supportCard: () => "",
});
view.renderAffiliateApplication();
const dashboardHtml = view.mount.innerHTML;
const verification = "For a PTA or fundraiser group to participate, an individual representative must first be verified, including their authority to act for the group.";

for (const [name, html, prefix] of [
  ["public", publicHtml, "affiliate-public"],
  ["signed-in", dashboardHtml, "affiliate-applicant"],
]) {
  test(`${name} invitation welcomes groups and requires a verified representative before participation`, () => {
    assert.ok(html.includes("Individuals, creators, PTAs, and fundraiser groups are welcome to apply"));
    assert.ok(html.includes(verification));
    assert.ok(html.indexOf(verification) < html.indexOf("<form"), "Requirement is visible before the application fields");
    assert.ok(html.includes("For a group application, enter the individual representative's name."));
    assert.ok(html.includes("include its name and your role in the group."));
    assert.match(html, /Group, community, or another profile/);
    assert.ok(html.includes(`aria-describedby="${prefix}-name-help"`));
    assert.ok(html.includes(`aria-describedby="${prefix}-intro-help`));
    assert.doesNotMatch(html, /Stripe verifies (?:your|the) (?:group|PTA)|automatically verified|payouts (?:go|are sent) directly to (?:your|the) group/i);
  });
}

test("group guidance uses the existing application fields without weakening validation", () => {
  const fields = {
    displayName: "Sample Representative",
    email: "representative@example.test",
    otherSocial: "Sample School PTA",
    introduction: "I am the PTA treasurer and plan to share SineDay with our school community.",
  };
  const result = validateAffiliateApplicationInput(fields);
  assert.equal(result.ok, true);
  assert.equal(result.fields.displayName, fields.displayName);
  assert.equal(result.fields.otherSocial, fields.otherSocial);
  assert.equal(result.fields.introduction, fields.introduction);
  assert.equal(validateAffiliateApplicationInput({ ...fields, otherSocial: "" }).ok, false);
});
