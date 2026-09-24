import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  auditDailyEmailTemplates,
  validateConfirmationTemplate,
  validateDailyTemplate,
  validateWelcomeTemplate
} from "../scripts/audit-daily-email-templates.mjs";
import { DAILY_SINEDAY_TITLES } from "../api/_lib/daily-email.js";

const TEMPLATE_DIR = join(process.cwd(), "docs/email-templates/20260924");
const PREVIOUS_TEMPLATE_DIR = join(process.cwd(), "docs/email-templates/20260923");
const VCARD_PATH = join(process.cwd(), "assets/email/sineday-daily.vcf");
const CONTACT_CARD_URL = "https://sineday.app/assets/email/sineday-daily.vcf";
const CONFIRMATION_PATH = join(
  process.cwd(),
  "docs/email-templates/20260915/confirmation.html"
);

function visualShell(innerHtml = "", artworkSurface = "day-scene") {
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
          <tr><td data-sineday-surface="${artworkSurface}" bgcolor="#0A0D14" style="background-color:#0A0D14;">${innerHtml}</td></tr>
          <tr><td data-sineday-surface="footer" bgcolor="#080A10" style="background-color:#080A10;">{{{OPT_OUT_URL}}}</td></tr>
        </table>
      </body>
    </html>
  `;
}

function welcomeShell() {
  return visualShell(`
    <img src="https://sineday.app/assets/email/20260923/sineducks/SineDuckCelebrity.png" width="464" height="261" border="0" alt="Meet SineDuck" style="display:block">
    <a href="${CONTACT_CARD_URL}">Add SineDay to Contacts</a>
  `, "duck-artwork");
}

function dailyTemplate(day = 17, alias = "day17emergingfoundation") {
  return {
    alias,
    status: "published",
    subject: `Your SineDay — Day ${day}: Foundation`,
    html: visualShell(`
      <p>Day ${day}</p>
      <img
        src="https://sineday.app/assets/email/20260924/scenes/SineDayScene${day}.png"
        width="464" height="464"
        border="0"
        alt="Day ${day} — ${DAILY_SINEDAY_TITLES[day]} nature scene with SineDuck"
        style="display:block;width:100%;max-width:464px;height:auto;border:0;"
      >
      <img
        src="https://sineday.app/assets/email/20260911/wave-${String(day).padStart(2, "0")}.png"
        alt="Day ${day}: today’s place on the repeating 18-day wave."
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

test("daily template audit catches wrong-day subject, HTML, and scene content", () => {
  const template = dailyTemplate(1, "day17emergingfoundation");
  template.html += '<img src="https://sineday.app/assets/sineducks/SineDuck18@3x.png">';

  const failures = validateDailyTemplate(
    template,
    17,
    "day17emergingfoundation"
  );

  assert.ok(failures.includes("subject-day"));
  assert.ok(failures.includes("html-day"));
  assert.ok(failures.includes("expected-scene"));
  assert.ok(failures.includes("legacy-artwork"));
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

test("confirmation template requires explicit consent safety and visual semantics", () => {
  const html = readFileSync(CONFIRMATION_PATH, "utf8");
  assert.deepEqual(
    validateConfirmationTemplate({
      alias: "dailyemailconfirmation",
      status: "published",
      html
    }),
    []
  );
  assert.match(html, /\{\{\{CONFIRM_URL\}\}\}/);
  assert.match(html, /Opening this email alone will not subscribe you/);
  assert.doesNotMatch(html, /OPT_OUT_URL/);
});

test("confirmation audit accepts editor-normalized markup without repository markers", () => {
  const html = readFileSync(CONFIRMATION_PATH, "utf8")
    .replace(/\sdata-sineday-(?:email-wrapper|surface)=["'][^"']+["']/gi, "")
    .replace(/\sbgcolor=["'][^"']+["']/gi, "")
    .replace(/<meta name="(?:color-scheme|supported-color-schemes)"[^>]*>\s*/gi, "");

  assert.doesNotMatch(html, /data-sineday-|bgcolor=/i);
  assert.deepEqual(
    validateConfirmationTemplate({
      alias: "dailyemailconfirmation",
      status: "published",
      html,
    }),
    [],
  );
});

test("confirmation audit rejects unsafe links, variables, active content, and missing visual semantics", () => {
  const html = readFileSync(CONFIRMATION_PATH, "utf8");
  const cases = [
    [html.replace("</body>", "{{{CONFIRM_URL}}}</body>"), "confirm-url-count"],
    [html.replace(' ses:no-track="true"', ""), "confirm-tracking"],
    [html.replaceAll("{{{CONFIRM_URL}}}", "{{{OTHER_URL}}}"), "confirm-url"],
    [html.replaceAll("{{{CONFIRM_URL}}}", "{{{OTHER_URL}}}"), "confirmation-variable"],
    [html.replace("Opening this email alone will not subscribe you.", ""), "explicit-confirmation"],
    [html.replace("</body>", "<form><input></form></body>"), "confirmation-active-content"],
    [html.replaceAll("#121826", "#FFFFFF"), "confirmation-surfaces"],
    [html.replaceAll("#7AA7FF", "#FFFFFF"), "confirmation-accent"],
  ];

  for (const [candidate, expectedFailure] of cases) {
    assert.ok(
      validateConfirmationTemplate({
        alias: "dailyemailconfirmation",
        status: "published",
        html: candidate,
      }).includes(expectedFailure),
      expectedFailure,
    );
  }
});

test("daily templates retain the stricter instrumented visual-shell contract", () => {
  const template = dailyTemplate();
  template.html = template.html.replace(/\sdata-sineday-[^=]+=["'][^"']+["']/gi, "");
  const failures = validateDailyTemplate(template, 17, template.alias);
  assert.ok(failures.includes("visual-wrapper"));
  assert.ok(failures.includes("surface-outer"));
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

test("checked-in daily HTML sources lock the dark canvas and use matching scenes", () => {
  const files = readdirSync(TEMPLATE_DIR).filter((name) => name.endsWith(".html"));
  assert.equal(files.length, 18);

  for (const name of files) {
    const html = readFileSync(join(TEMPLATE_DIR, name), "utf8");
    const template = {
      alias: "day17emergingfoundation",
      status: "published",
      subject: "Your SineDay — Day 17: Foundation",
      html
    };

    const day = Number(name.match(/^day-(\d{2})\.html$/)[1]);
    const failures = validateDailyTemplate(template, day, template.alias).filter(
      (failure) => !["alias", "subject-day"].includes(failure)
    );
    assert.deepEqual(failures, [], name);
    assert.doesNotMatch(html, /sineday-daily\.vcf/);
    assert.match(html, /data-sineday-surface="day-scene"[^>]*bgcolor="#0A0D14"/);
    assert.match(html, new RegExp(`SineDayScene${day}\\.png`));
    assert.match(
      html,
      new RegExp(
        `alt="Day ${day} — ${DAILY_SINEDAY_TITLES[day]} nature scene with SineDuck"`,
      ),
    );
  }
});

test("20260924 snapshot changes only the daily hero contract and preserves plain text", () => {
  for (let day = 1; day <= 18; day += 1) {
    const number = String(day).padStart(2, "0");
    const htmlName = `day-${number}.html`;
    const textName = `day-${number}.txt`;
    const previousHtml = readFileSync(join(PREVIOUS_TEMPLATE_DIR, htmlName), "utf8");
    const currentHtml = readFileSync(join(TEMPLATE_DIR, htmlName), "utf8");
    const previousAlt =
      `alt="Official SineDuck for Day ${day} — ${DAILY_SINEDAY_TITLES[day]}"`;
    const currentAlt =
      `alt="Day ${day} — ${DAILY_SINEDAY_TITLES[day]} nature scene with SineDuck"`;
    assert.equal(
      previousHtml.split(previousAlt).length - 1,
      1,
      `${htmlName} must contain exactly one replaceable 20260923 hero alt`,
    );
    const expectedHtml = previousHtml
      .replace(
        `https://sineday.app/assets/email/20260923/sineducks/SineDuckFinale${day}.png`,
        `https://sineday.app/assets/email/20260924/scenes/SineDayScene${day}.png`,
      )
      .replace('width="464" height="261"', 'width="464" height="464"')
      .replace(previousAlt, currentAlt)
      .replace(
        'data-sineday-surface="duck-artwork"',
        'data-sineday-surface="day-scene"',
      );

    assert.notEqual(expectedHtml, previousHtml, `${htmlName} transformation must change source`);
    assert.ok(expectedHtml.includes(currentAlt), `${htmlName} replacement alt must be present`);
    assert.ok(!expectedHtml.includes(previousAlt), `${htmlName} old hero alt must be removed`);
    assert.equal(currentHtml, expectedHtml, htmlName);
    assert.deepEqual(
      readFileSync(join(TEMPLATE_DIR, textName)),
      readFileSync(join(PREVIOUS_TEMPLATE_DIR, textName)),
      textName,
    );
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

test('scene audit rejects stale assets, wrong dimensions, insecure URLs and cropped scenes', () => {
  for (const [from, to, failure] of [
    ['SineDayScene17.png', 'SineDuck17@3x.png', 'expected-scene'],
    ['height="464"', 'height="261"', 'scene-image'],
    ['https://sineday.app/assets/email/', 'http://sineday.app/assets/email/', 'expected-scene'],
    ['display:block', 'display:inline', 'scene-image'],
    ['alt="Day 17 — Foundation nature scene with SineDuck"', 'alt=""', 'scene-image'],
    ['height:auto', 'height:auto;object-fit:cover', 'scene-crop']
  ]) {
    const template = dailyTemplate();
    template.html = template.html.replace(from, to);
    assert.ok(validateDailyTemplate(template, 17, template.alias).includes(failure), failure);
  }
});

test("daily template audit requires exactly one matching Day-specific wave image", () => {
  const expectedWave =
    "https://sineday.app/assets/email/20260911/wave-17.png";

  const missing = dailyTemplate();
  missing.html = missing.html.replace(expectedWave, "");
  assert.ok(
    validateDailyTemplate(missing, 17, missing.alias).includes("expected-wave"),
  );
  assert.ok(
    validateDailyTemplate(missing, 17, missing.alias).includes("wave-count"),
  );

  const duplicate = dailyTemplate();
  duplicate.html = duplicate.html.replace(
    expectedWave,
    `${expectedWave}${expectedWave}`,
  );
  assert.ok(
    validateDailyTemplate(duplicate, 17, duplicate.alias).includes("expected-wave"),
  );
  assert.ok(
    validateDailyTemplate(duplicate, 17, duplicate.alias).includes("wave-count"),
  );

  const wrongDay = dailyTemplate();
  wrongDay.html = wrongDay.html.replace(expectedWave, "https://sineday.app/assets/email/20260911/wave-18.png");
  const wrongDayFailures = validateDailyTemplate(wrongDay, 17, wrongDay.alias);
  assert.ok(wrongDayFailures.includes("expected-wave"));
  assert.ok(wrongDayFailures.includes("wrong-wave"));
  assert.ok(!wrongDayFailures.includes("legacy-artwork"));
});
