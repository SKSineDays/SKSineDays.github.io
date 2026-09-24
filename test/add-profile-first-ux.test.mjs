import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "dashboard.html"), "utf8");
const css = readFileSync(join(root, "css/dashboard.css"), "utf8");
const dashboardJs = readFileSync(join(root, "js/dashboard.js"), "utf8");
const addProfileSheetHtml = html.slice(
  html.indexOf('id="add-profile-sheet"'),
  html.indexOf('id="manage-profiles-sheet"'),
);
const addProfileFormHtml = addProfileSheetHtml.slice(
  addProfileSheetHtml.indexOf('<form id="add-profile-form">'),
  addProfileSheetHtml.indexOf("</form>") + 7,
);
const handleAddProfileJs = dashboardJs.slice(
  dashboardJs.indexOf("async function handleAddProfile"),
  dashboardJs.indexOf("async function handleUpdateProfile"),
);
const initJs = dashboardJs.slice(
  dashboardJs.indexOf("async function init()"),
  dashboardJs.indexOf("async function loadUserData"),
);
const presentationJs = dashboardJs.slice(
  dashboardJs.indexOf("function updateAddProfilePresentation"),
  dashboardJs.indexOf("function ensureTimezoneOption"),
);
const addProfileSetupJs = dashboardJs.slice(
  dashboardJs.indexOf("function setupAddProfileCollapse()"),
  dashboardJs.indexOf("function setupManageProfilesSheet()"),
);
const profileSheetControllerJs = dashboardJs.slice(
  dashboardJs.indexOf("let activeProfileSheet"),
  dashboardJs.indexOf("/**\n * Set up Add Profile"),
);

test("Add Profile stays one existing sheet and one form", () => {
  assert.equal((html.match(/id="add-profile-form"/g) || []).length, 1);
  assert.equal((html.match(/id="add-profile-sheet"/g) || []).length, 1);
  assert.equal((html.match(/id="add-profile-btn"/g) || []).length, 1);
  assert.match(addProfileSheetHtml, /<h3 id="add-profile-title">Add a profile<\/h3>/);
  assert.match(addProfileSheetHtml, /aria-labelledby="add-profile-title"/);
  assert.doesNotMatch(addProfileSheetHtml, /<div[^>]*id="add-profile-title"/);
});

test("profile sheets are top-level modal siblings outside the transformed pager", () => {
  const pagerStart = html.indexOf('class="dashboard-pager__viewport"');
  const pagerEnd = html.indexOf("</main>");
  const addSheet = html.indexOf('id="add-profile-sheet"');
  const manageSheet = html.indexOf('id="manage-profiles-sheet"');
  assert.ok(pagerStart >= 0 && pagerEnd > pagerStart);
  assert.ok(addSheet > pagerEnd);
  assert.ok(manageSheet > pagerEnd);
  assert.equal((html.match(/id="manage-profiles-sheet"/g) || []).length, 1);
});

test("first-profile copy is presentation-only and hidden until JS reveals it", () => {
  assert.match(
    addProfileSheetHtml,
    /<p id="add-profile-eyebrow" class="feature-hero__eyebrow" hidden><\/p>/,
  );
  assert.match(
    addProfileSheetHtml,
    /<p id="add-profile-intro" class="add-profile-sheet__intro" hidden><\/p>/,
  );
  assert.match(css, /\.add-profile-sheet__intro\s*\{/);
  assert.match(css, /\.add-profile-sheet__intro\[hidden\]/);
});

test("form labels stay wired to the existing inputs", () => {
  assert.match(addProfileFormHtml, /<label for="profile-name">Name<\/label>/);
  assert.match(addProfileFormHtml, /<input type="text" id="profile-name"/);
  assert.match(addProfileFormHtml, /<label for="profile-birthdate">Birthdate<\/label>/);
  assert.match(addProfileFormHtml, /<input type="date" id="profile-birthdate"/);
  assert.match(addProfileFormHtml, /<label for="profile-timezone">Timezone<\/label>/);
  assert.match(addProfileFormHtml, /<select id="profile-timezone">/);
});

test("updateAddProfilePresentation centralizes first vs additional vs edit copy", () => {
  assert.match(presentationJs, /const isFirstProfile = !isEdit && !hasOwnerProfile\(\);/);
  assert.match(presentationJs, /title: "Start with you"/);
  assert.match(
    presentationJs,
    /Your first profile becomes the anchor for your private journal, history, and daily wave\./,
  );
  assert.match(presentationJs, /You can add family and friends afterward\./);
  assert.match(presentationJs, /eyebrow: "Your SineDay"/);
  assert.match(presentationJs, /submit: "Start My SineDay"/);
  assert.match(presentationJs, /nameLabel: "Your name"/);
  assert.match(presentationJs, /birthdateLabel: "Your birthdate"/);
  assert.match(presentationJs, /title: "Add a profile"/);
  assert.match(presentationJs, /submit: "Save Profile"/);
  assert.match(presentationJs, /title: "Edit profile"/);
  assert.match(presentationJs, /submit: "Save changes"/);
  assert.doesNotMatch(presentationJs, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(presentationJs, /is_owner/);
  assert.doesNotMatch(dashboardJs, /hasCompletedOnboarding|firstProfileCreated|onboardingComplete/);
});

test("Add Profile sheet applies presentation immediately before opening", () => {
  assert.match(addProfileSetupJs, /updateAddProfilePresentation\(\);/);
  const presentationIndex = addProfileSetupJs.indexOf("updateAddProfilePresentation();");
  const openIndex = addProfileSetupJs.indexOf("openProfileSheet(entry");
  assert.ok(presentationIndex >= 0 && openIndex > presentationIndex);
  assert.match(
    addProfileSetupJs,
    /profileFormMode = "add";\s*editingProfileId = null;\s*updateAddProfilePresentation\(\);/,
  );
  assert.doesNotMatch(initJs, /addProfileUI\?\.open|addProfileUI\.open/);
});

test("shared profile-sheet controller owns focus, inert background, and one balanced lock", () => {
  assert.match(profileSheetControllerJs, /let activeProfileSheet = null/);
  assert.match(profileSheetControllerJs, /activeProfileSheet && activeProfileSheet !== entry/);
  assert.match(profileSheetControllerJs, /deactivateProfileSheet\(activeProfileSheet, \{ immediate: true \}\)/);
  assert.match(profileSheetControllerJs, /document\.querySelector\("main"\)/);
  assert.match(profileSheetControllerJs, /document\.querySelector\("\.site-footer"\)/);
  assert.match(profileSheetControllerJs, /document\.documentElement\.classList\.toggle\("modal-open", disabled\)/);
  assert.match(profileSheetControllerJs, /document\.body\.classList\.toggle\("modal-open", disabled\)/);
  assert.match(profileSheetControllerJs, /document\.addEventListener\("keydown"/);
  assert.match(profileSheetControllerJs, /event\.key === "Escape"/);
  assert.match(profileSheetControllerJs, /trapFocusWithin\(activeProfileSheet\.panel, event\)/);
  assert.match(profileSheetControllerJs, /opener\?\.isConnected \? opener : entry\.toggle/);
  assert.match(css, /max-height:\s*min\(85vh,\s*calc\(100dvh/);
  assert.match(css, /overscroll-behavior-y:\s*contain/);
  assert.match(css, /touch-action:\s*pan-y/);
});

test("first saved profile still becomes owner through existing insert logic", () => {
  assert.match(handleAddProfileJs, /const shouldBecomeOwner = !hasOwnerProfile\(\);/);
  assert.match(handleAddProfileJs, /is_owner:\s*shouldBecomeOwner/);
  assert.match(handleAddProfileJs, /user_id:\s*currentUser\.id/);
  assert.match(handleAddProfileJs, /display_name:\s*name/);
  assert.match(handleAddProfileJs, /birthdate:\s*birthdate/);
  assert.match(handleAddProfileJs, /timezone:\s*timezone \|\| 'America\/Chicago'/);
  assert.doesNotMatch(handleAddProfileJs, /checkbox|is_owner:\s*true|is_owner:\s*false/);
  assert.match(handleAddProfileJs, /Your SineDay is ready\./);
  assert.match(handleAddProfileJs, /Profile added successfully!/);
  assert.doesNotMatch(handleAddProfileJs, /Owner profile added/);
});

test("Journal waiting copy and Daily Duck stay separate from owner-profile UX", () => {
  assert.match(
    dashboardJs,
    /title: "Journal is waiting",\s*body: "Add your first profile to begin your SineDay journal\."/,
  );
  assert.match(dashboardJs, /journalUI\?\.setOwnerProfile\?\.\(getOwnerProfile\(\)\)/);
  assert.doesNotMatch(handleAddProfileJs, /\/api\/subscribe|dailyEmail|daily-email-birthdate/);
  assert.match(html, /id="daily-email-setup-sheet"/);
  assert.match(html, /id="daily-email-birthdate"/);
  assert.match(dashboardJs, /Never allow deleting the owner profile/);
  assert.match(dashboardJs, /<span class="owner-badge">Owner<\/span>/);
});

function applyAddProfilePresentation({ mode = "add", hasOwner = false } = {}) {
  const nodes = new Map();
  const makeNode = (id, textContent = "", hidden = true) => {
    const node = { id, textContent, hidden };
    nodes.set(id, node);
    return node;
  };
  makeNode("add-profile-eyebrow");
  makeNode("add-profile-title", "Add a profile", false);
  makeNode("add-profile-intro");
  makeNode("add-profile-btn", "Save Profile", false);
  const nameLabel = { textContent: "Name" };
  const birthdateLabel = { textContent: "Birthdate" };
  const document = {
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (selector) => {
      if (selector === 'label[for="profile-name"]') return nameLabel;
      if (selector === 'label[for="profile-birthdate"]') return birthdateLabel;
      return null;
    },
  };
  const run = new Function(
    "document",
    "profileFormMode",
    "hasOwnerProfile",
    `${presentationJs}\nupdateAddProfilePresentation();`,
  );
  run(document, mode, () => hasOwner);
  return {
    eyebrow: nodes.get("add-profile-eyebrow"),
    title: nodes.get("add-profile-title"),
    intro: nodes.get("add-profile-intro"),
    submit: nodes.get("add-profile-btn"),
    nameLabel,
    birthdateLabel,
  };
}

test("first-profile presentation appears only when no owner exists", () => {
  const first = applyAddProfilePresentation({ mode: "add", hasOwner: false });
  assert.equal(first.eyebrow.hidden, false);
  assert.equal(first.eyebrow.textContent, "Your SineDay");
  assert.equal(first.title.textContent, "Start with you");
  assert.match(first.intro.textContent, /private journal, history, and daily wave/);
  assert.match(first.intro.textContent, /You can add family and friends afterward/);
  assert.equal(first.submit.textContent, "Start My SineDay");
  assert.equal(first.nameLabel.textContent, "Your name");
  assert.equal(first.birthdateLabel.textContent, "Your birthdate");

  const next = applyAddProfilePresentation({ mode: "add", hasOwner: true });
  assert.equal(next.eyebrow.hidden, true);
  assert.equal(next.eyebrow.textContent, "");
  assert.equal(next.title.textContent, "Add a profile");
  assert.equal(next.intro.hidden, true);
  assert.equal(next.submit.textContent, "Save Profile");
  assert.equal(next.nameLabel.textContent, "Name");
  assert.equal(next.birthdateLabel.textContent, "Birthdate");

  const edit = applyAddProfilePresentation({ mode: "edit", hasOwner: false });
  assert.equal(edit.title.textContent, "Edit profile");
  assert.equal(edit.submit.textContent, "Save changes");
  assert.equal(edit.intro.hidden, true);
  assert.doesNotMatch(edit.title.textContent, /Start with you/);
});
