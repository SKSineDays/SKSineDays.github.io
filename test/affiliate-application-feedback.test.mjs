import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const script = readFileSync(new URL("../js/affiliate-application.js", import.meta.url), "utf8");
const validApplication = {
  displayName: "Wave Writer",
  email: "Writer@Example.COM",
  instagram: "@wavewriter",
  tiktok: "",
  youtube: "",
  website: "",
  otherSocial: "",
  introduction: "I share a daily journaling practice with my community.",
  company: "",
};
const fieldIds = {
  displayName: "name", email: "email", instagram: "instagram", tiktok: "tiktok",
  youtube: "youtube", website: "website", otherSocial: "other", introduction: "intro", company: "company",
};

function createPage({ values = {}, fetch, reducedMotion = false } = {}) {
  const nodes = new Map();
  const listeners = new Map();
  const requests = [];
  const document = {
    activeElement: null,
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => node(),
  };
  function node(id = "", textContent = "") {
    const attributes = new Map();
    const element = {
      id, textContent, hidden: false, value: "", disabled: false,
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name),
      after: (child) => nodes.set(child.id, child),
      remove: () => nodes.delete(element.id),
      focus: () => { document.activeElement = element; },
      querySelector: () => null,
    };
    if (id) nodes.set(id, element);
    return element;
  }
  const fields = {};
  for (const [name, suffix] of Object.entries(fieldIds)) {
    fields[name] = node(`affiliate-public-${suffix}`);
    fields[name].name = name;
    fields[name].value = { ...validApplication, ...values }[name];
    fields[name].setAttribute("aria-describedby", `${fields[name].id}-help`);
  }
  const label = node("", "Send application");
  const submit = node();
  submit.querySelector = (selector) => selector === "[data-submit-label]" ? label : null;
  const form = node("affiliate-public-form");
  form.elements = { namedItem: (name) => fields[name] || null };
  form.addEventListener = (name, callback) => listeners.set(name, callback);
  form.querySelector = (selector) => selector === '[type="submit"]' ? submit : null;
  form.resetCount = 0;
  form.reset = () => {
    form.resetCount += 1;
    for (const field of Object.values(fields)) field.value = "";
  };
  const success = node("affiliate-public-success");
  const heading = node();
  success.hidden = true;
  success.querySelector = (selector) => selector === "h3" ? heading : null;
  success.scrollIntoView = (options) => { success.scrollOptions = options; };
  const error = node("affiliate-public-error");
  error.hidden = true;
  const status = node("affiliate-public-status");
  const counter = node("affiliate-public-intro-count");
  const context = createContext({
    document,
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    FormData: class {
      constructor() {
        this.values = new Map(Object.entries(fields).map(([name, field]) => [name, field.value]));
      }
      get(name) { return this.values.get(name); }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetch ? fetch(url, options) : { ok: true, json: async () => ({ ok: true }) };
    },
  });
  runInContext(script, context);
  return {
    context, document, fields, form, submit, label, success, heading, error, status, counter, nodes, requests,
    send: () => listeners.get("submit")({ preventDefault() {} }),
    edit(name, value) {
      fields[name].value = value;
      listeners.get("input")({ target: fields[name] });
    },
  };
}

function errorsFor(values = {}) {
  const page = createPage();
  return page.context.validateForm(new Map(Object.entries({ ...validApplication, ...values })));
}

test("client validation preserves all trimmed length, email, and social constraints", () => {
  for (const values of [
    { displayName: "A" }, { displayName: "a".repeat(81) }, { displayName: "  A  " },
    { email: "" }, { email: "a@b" }, { email: "name @example.com" },
    { email: `${"a".repeat(243)}@example.com` },
    { introduction: "a".repeat(19) }, { introduction: "a".repeat(1001) },
    { introduction: ` ${"a".repeat(19)} ` },
    { instagram: " \t " },
  ]) {
    assert.ok(errorsFor(values).length, JSON.stringify(values));
  }
  for (const name of ["instagram", "tiktok", "youtube", "website", "otherSocial"]) {
    assert.ok(errorsFor({ [name]: "x".repeat(301) }).length, `${name} max length`);
    assert.equal(errorsFor({ instagram: "", [name]: "x".repeat(300) }).length, 0, `${name} boundary`);
    assert.equal(errorsFor({ instagram: "", [name]: " @profile " }).length, 0, `${name} counts as profile`);
  }
  for (const values of [
    { displayName: "  AB  " }, { displayName: "a".repeat(80) },
    { email: ` ${"a".repeat(242)}@example.com ` },
    { introduction: ` ${"a".repeat(20)} ` }, { introduction: "a".repeat(1000) },
  ]) {
    assert.equal(errorsFor(values).length, 0, JSON.stringify(values));
  }
});

test("invalid submission adds accessible inline errors, preserves help, and focuses the first field", async () => {
  const page = createPage({ values: { displayName: "A", email: "invalid", introduction: "short" } });
  await page.send();
  assert.equal(page.requests.length, 0);
  assert.equal(page.document.activeElement, page.fields.displayName);
  assert.equal(page.error.hidden, false);
  for (const name of ["displayName", "email", "introduction"]) {
    const field = page.fields[name];
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(field.getAttribute("aria-describedby"), `${field.id}-help ${field.id}-error`);
    assert.equal(page.nodes.get(`${field.id}-error`).className, "affiliate-public__field-error");
  }
  page.edit("displayName", "Writer");
  assert.equal(page.fields.displayName.getAttribute("aria-invalid"), null);
  assert.equal(page.fields.displayName.getAttribute("aria-describedby"), "affiliate-public-name-help");
  assert.equal(page.nodes.has("affiliate-public-name-error"), false);
  assert.equal(page.fields.email.getAttribute("aria-invalid"), "true");
  assert.equal(page.error.hidden, false);
  page.edit("email", "writer@example.com");
  page.edit("introduction", validApplication.introduction);
  assert.equal(page.error.hidden, true);
});

test("missing social input has one inline error associated with every eligible field", async () => {
  const page = createPage({ values: { instagram: "  " } });
  await page.send();
  const socialNames = ["instagram", "tiktok", "youtube", "website", "otherSocial"];
  assert.equal(page.document.activeElement, page.fields.instagram);
  assert.equal(page.nodes.get("affiliate-public-instagram-error").textContent, "Please share at least one social profile or website.");
  for (const name of socialNames) {
    assert.equal(page.fields[name].getAttribute("aria-invalid"), "true");
    assert.ok(page.fields[name].getAttribute("aria-describedby").endsWith("affiliate-public-instagram-error"));
  }
  page.edit("website", "https://example.com");
  for (const name of socialNames) {
    assert.equal(page.fields[name].getAttribute("aria-invalid"), null);
    assert.equal(page.fields[name].getAttribute("aria-describedby"), `${page.fields[name].id}-help`);
  }
  assert.equal(page.error.hidden, true);
});

test("revalidation never duplicates inline error IDs or description tokens", async () => {
  const page = createPage({ values: { email: "invalid" } });
  await page.send();
  await page.send();
  assert.equal(page.fields.email.getAttribute("aria-describedby"), "affiliate-public-email-help affiliate-public-email-error");
  assert.equal([...page.nodes.keys()].filter((id) => id === "affiliate-public-email-error").length, 1);
});

test("submission keeps the exact anonymous POST contract, including trimmed honeypot and email casing", async () => {
  const values = Object.fromEntries(Object.entries(validApplication).map(([name, value]) => [name, `  ${value}  `]));
  values.company = "  honeypot-value  ";
  const page = createPage({ values });
  await page.send();
  assert.equal(page.requests.length, 1);
  const { url, options } = page.requests[0];
  assert.equal(url, "/api/affiliate/application");
  assert.equal(options.method, "POST");
  assert.deepEqual(Object.keys(options), ["method", "headers", "body"]);
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { ...validApplication, company: "honeypot-value" });
  assert.equal(page.form.hidden, true);
  assert.equal(page.form.resetCount, 1);
  assert.equal(page.success.hidden, false);
  assert.equal(page.document.activeElement, page.heading);
  assert.equal(page.success.scrollOptions.behavior, "smooth");
  assert.equal(page.counter.textContent, "0 / 1,000");
});

test("pending and completed requests reject repeated programmatic submissions", async () => {
  let resolveRequest;
  const page = createPage({ fetch: () => new Promise((resolve) => { resolveRequest = resolve; }) });
  const first = page.send();
  await page.send();
  await page.send();
  assert.equal(page.requests.length, 1);
  assert.equal(page.submit.disabled, true);
  assert.equal(page.submit.getAttribute("aria-busy"), "true");
  assert.equal(page.label.textContent, "Sending application…");
  assert.equal(page.status.textContent, "Sending application…");
  assert.equal(page.success.hidden, true);
  resolveRequest({ ok: true, json: async () => ({ ok: true }) });
  await first;
  await page.send();
  assert.equal(page.requests.length, 1);
  assert.equal(page.submit.disabled, false);
  assert.equal(page.label.textContent, "Send application");
  assert.equal(page.status.textContent, "");
});

for (const [label, failure] of [
  ["server rejection", async () => ({ ok: false, json: async () => ({ error: "Please try later." }) })],
  ["unsuccessful JSON result", async () => ({ ok: true, json: async () => ({ ok: false }) })],
  ["unreadable JSON result", async () => ({ ok: true, json: async () => { throw new Error("Invalid JSON"); } })],
  ["network interruption", async () => { throw new Error("Connection interrupted."); }],
]) {
  test(`${label} preserves entries, focuses feedback, and allows a successful retry`, async () => {
    let failed = false;
    const page = createPage({ fetch: async () => {
      if (!failed) { failed = true; return failure(); }
      return { ok: true, json: async () => ({ ok: true }) };
    } });
    await page.send();
    assert.equal(page.form.hidden, false);
    assert.equal(page.form.resetCount, 0);
    assert.equal(page.success.hidden, true);
    assert.equal(page.error.hidden, false);
    assert.match(page.error.textContent, /Your entries are still here\. Please try again\./);
    assert.equal(page.document.activeElement, page.error);
    assert.equal(page.fields.displayName.value, validApplication.displayName);
    assert.equal(page.fields.email.value, validApplication.email);
    assert.equal(page.fields.introduction.value, validApplication.introduction);
    assert.equal(page.submit.disabled, false);
    assert.equal(page.submit.getAttribute("aria-busy"), "false");
    assert.equal(page.label.textContent, "Send application");
    assert.equal(page.status.textContent, "");
    await page.send();
    assert.equal(page.requests.length, 2);
    assert.equal(page.form.hidden, true);
    assert.equal(page.success.hidden, false);
    assert.equal(page.error.hidden, true);
  });
}

test("success scrolling honors reduced motion", async () => {
  const page = createPage({ reducedMotion: true });
  await page.send();
  assert.equal(page.success.scrollOptions.behavior, "instant");
  assert.equal(page.document.activeElement, page.heading);
});

test("introduction counter counts trimmed input without a live announcement", () => {
  const page = createPage();
  assert.equal(page.counter.textContent, `${validApplication.introduction.length} / 1,000`);
  page.edit("introduction", "  a short introduction  ");
  assert.equal(page.counter.textContent, "20 / 1,000");
  page.edit("introduction", "a".repeat(1000));
  assert.equal(page.counter.textContent, "1,000 / 1,000");
  assert.equal(page.counter.getAttribute("aria-live"), null);
});
