import test from "node:test";
import assert from "node:assert/strict";
import {
  auditDailyEmailTemplates,
  validateDailyTemplate,
  validateWelcomeTemplate
} from "../scripts/audit-daily-email-templates.mjs";

function visualShell(innerHtml = "") {
  return `
    <!DOCTYPE html>
    <html lang="en">
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
      html: visualShell()
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
