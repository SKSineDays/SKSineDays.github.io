import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  auditDailyEmailTemplates,
  validateDailyTemplate,
  validateWelcomeTemplate
} from "../scripts/audit-daily-email-templates.mjs";

const TEMPLATE_DIR = join(process.cwd(), "docs/email-templates/20260911");
const VCARD_PATH = join(process.cwd(), "assets/email/sineday-daily.vcf");
const CONTACT_CARD_URL = "https://sineday.app/assets/email/sineday-daily.vcf";

function visualShell(innerHtml = "") {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
      </head>
      <body
        data-sineday-surface="outer"
        bgcolor="#05060A"
        style="background-color:#05060A;"
      >
        <table
          role="presentation"
          data-sineday-email-wrapper="true"
          data-sineday-surface="card"
          bgcolor="#0D111B"
          style="background-color:#0D111B;"
        >
          <tr><td data-sineday-surface="accent" bgcolor="#7AA7FF" style="background-color:#7AA7FF;">&nbsp;</td></tr>
          <tr><td data-sineday-surface="header" bgcolor="#0A0D14" style="background-color:#0A0D14;">Header</td></tr>
          <tr><td data-sineday-surface="notice" bgcolor="#121826" style="background-color:#121826;">Notice</td></tr>
          <tr><td data-sineday-surface="reflection" bgcolor="#101725" style="background-color:#101725;">Reflection</td></tr>
          <tr><td data-sineday-surface="duck-plate" bgcolor="#FFFFFF" style="background-color:#FFFFFF;">${innerHtml}</td></tr>
          <tr><td data-sineday-surface="footer" bgcolor="#080A10" style="background-color:#080A10;">{{{OPT_OUT_URL}}}</td></tr>
        </table>
      </body>
    </html>
  `;
}

function welcomeShell() {
  return visualShell(`
    <a href="${CONTACT_CARD_URL}">Add SineDay to Contacts</a>
  `);
}

function dailyTemplate(day = 17, alias = "day17emergingfoundation") {
  return {
    alias,
    status: "published",
    subject: `Your SineDay — Day ${day}: Foundation`,
    html: visualShell(`
      <p>Day ${day}</p>
      <img
        src="https://sineday.app/assets/sineducks/SineDuck${day}@3x.png"
        width="96"
        border="0"
        alt="SineDuck ${day} — Foundation"
        style="display:block;width:96px;height:auto;border:0;"
      >
    `)
  };
}

test("daily template audit accepts a published, correctly numbered robust shell", () => {
  assert.deepEqual(
    validateDailyTemplate(
      dailyTemplate(),
      17,
      "day17emergingfoundation"
    ),
    []
  );
});

test("daily template audit catches wrong-day subject, HTML, and SineDuck content", () => {
  const template = dailyTemplate(1, "day17emergingfoundation");
  template.html += '<img src="https://sineday.app/assets/sineducks/SineDuck18@3x.png">';

  const failures = validateDailyTemplate(
    template,
    17,
    "day17emergingfoundation"
  );

  assert.ok(failures.includes("subject-day"));
  assert.ok(failures.includes("html-day"));
  assert.ok(failures.includes("expected-duck"));
  assert.ok(failures.includes("wrong-duck"));
});

test("daily template audit catches missing publication, opt-out, and visual fallbacks", () => {
  const template = dailyTemplate();
  template.status = "draft";
  template.html = template.html
    .replace("{{{OPT_OUT_URL}}}", "")
    .replace('bgcolor="#121826"', "");

  const failures = validateDailyTemplate(
    template,
    17,
    "day17emergingfoundation"
  );

  assert.ok(failures.includes("published"));
  assert.ok(failures.includes("opt-out"));
  assert.ok(failures.includes("surface-notice"));
});

test("welcome template audit requires publication, unsubscribe, and shared shell", () => {
  assert.deepEqual(
    validateWelcomeTemplate({
      alias: "welcomeemail",
      status: "published",
      html: welcomeShell()
    }),
    []
  );

  const failures = validateWelcomeTemplate({
    alias: "welcomeemail",
    status: "draft",
    html: "<p>Welcome</p>"
  });
  assert.ok(failures.includes("published"));
  assert.ok(failures.includes("opt-out"));
  assert.ok(failures.includes("visual-wrapper"));
  assert.ok(failures.includes("contact-card"));
  assert.ok(failures.includes("contact-action"));
});

test("visual shell rejects dark-scheme invitations and requires the canvas lock", () => {
  const darkInvite = dailyTemplate();
  darkInvite.html = darkInvite.html
    .replace('content="light only"', 'content="dark"')
    .replace('content="light only"', 'content="dark"');

  const failures = validateDailyTemplate(
    darkInvite,
    17,
    "day17emergingfoundation"
  );
  assert.ok(failures.includes("dark-scheme-invite"));
  assert.ok(failures.includes("canvas-lock"));
});

test("checked-in HTML sources lock the dark canvas and keep the duck plate white", () => {
  const files = readdirSync(TEMPLATE_DIR).filter((name) => name.endsWith(".html"));
  assert.equal(files.length, 19);

  for (const name of files) {
    const html = readFileSync(join(TEMPLATE_DIR, name), "utf8");
    const template = {
      alias: name === "welcome.html" ? "welcomeemail" : "day17emergingfoundation",
      status: "published",
      subject: name === "welcome.html" ? "Welcome" : "Your SineDay — Day 17: Foundation",
      html
    };

    if (name === "welcome.html") {
      assert.deepEqual(validateWelcomeTemplate(template), []);
      assert.match(html, /Add SineDay to Contacts/);
      assert.ok(html.includes(CONTACT_CARD_URL));
      assert.ok(html.includes('ses:no-track="true"'));
      continue;
    }

    const day = Number(name.match(/^day-(\d{2})\.html$/)[1]);
    const failures = validateDailyTemplate(template, day, template.alias).filter(
      (failure) => !["alias", "subject-day"].includes(failure)
    );
    assert.deepEqual(failures, [], name);
    assert.doesNotMatch(html, /sineday-daily\.vcf/);
    assert.match(html, /data-sineday-surface="duck-plate"[^>]*bgcolor="#FFFFFF"/);
  }
});

test("public SineDay Daily vCard identifies the production sender", () => {
  const vcard = readFileSync(VCARD_PATH, "utf8");
  assert.match(vcard, /^BEGIN:VCARD\r?\n/);
  assert.match(vcard, /FN:SineDay Daily/);
  assert.match(vcard, /ORG:SineDay/);
  assert.match(vcard, /EMAIL;TYPE=INTERNET,PREF:daily@daily\.sineday\.app/);
  assert.match(vcard, /URL:https:\/\/sineday\.app/);
  assert.doesNotMatch(vcard, /stephen|krantz|mysine@sineday\.app/i);
});

test("network audit requires RESEND_API_KEY without making a request", async (t) => {
  t.mock.method(console, "error", () => {});
  let requested = false;
  const passed = await auditDailyEmailTemplates({
    apiKey: "",
    resend: {
      templates: {
        async get() {
          requested = true;
        }
      }
    }
  });

  assert.equal(passed, false);
  assert.equal(requested, false);
});
