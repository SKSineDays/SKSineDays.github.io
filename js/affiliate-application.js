const SOCIAL_FIELDS = ["instagram", "tiktok", "youtube", "website", "otherSocial"];

function fieldValue(form, name) {
  return String(form.get(name) || "").trim();
}

function hasSocialProfile(form) {
  return SOCIAL_FIELDS.some((name) => fieldValue(form, name));
}

function setBusy(button, busy, idleLabel) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
  const label = button.querySelector("[data-submit-label]") || button;
  label.textContent = busy ? "Sending application…" : idleLabel;
}

function showError(errorEl, message) {
  if (!errorEl) return;
  errorEl.hidden = !message;
  if (errorEl.textContent !== (message || "")) {
    errorEl.textContent = message || "";
  }
}

function showSuccess({ form, successEl }) {
  if (form) {
    form.reset();
    form.hidden = true;
  }
  if (successEl) {
    successEl.hidden = false;
    const heading = successEl.querySelector("h3");
    heading?.focus?.();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    successEl.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
  }
}

function validateForm(form) {
  const errors = [];
  const displayName = fieldValue(form, "displayName");
  if (displayName.length < 2 || displayName.length > 80) {
    errors.push({ names: ["displayName"], message: "Name must be between 2 and 80 characters." });
  }

  const email = fieldValue(form, "email").toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ names: ["email"], message: "Please enter a valid email address." });
  }

  if (!hasSocialProfile(form)) {
    errors.push({ names: SOCIAL_FIELDS, message: "Please share at least one social profile or website." });
  }

  for (const name of SOCIAL_FIELDS) {
    if (fieldValue(form, name).length > 300) {
      errors.push({ names: [name], message: "Social and profile links must be 300 characters or fewer." });
    }
  }

  const introduction = fieldValue(form, "introduction");
  if (introduction.length < 20 || introduction.length > 1000) {
    errors.push({ names: ["introduction"], message: "Please tell us a little about yourself in 20 to 1,000 characters." });
  }

  return errors;
}

function payloadFromForm(form) {
  return {
    displayName: fieldValue(form, "displayName"),
    email: fieldValue(form, "email"),
    instagram: fieldValue(form, "instagram"),
    tiktok: fieldValue(form, "tiktok"),
    youtube: fieldValue(form, "youtube"),
    website: fieldValue(form, "website"),
    otherSocial: fieldValue(form, "otherSocial"),
    introduction: fieldValue(form, "introduction"),
    company: fieldValue(form, "company"),
  };
}

function bindAffiliateApplicationForm() {
  const form = document.getElementById("affiliate-public-form");
  const successEl = document.getElementById("affiliate-public-success");
  const errorEl = document.getElementById("affiliate-public-error");
  const statusEl = document.getElementById("affiliate-public-status");
  const introCount = document.getElementById("affiliate-public-intro-count");
  if (!form) return;

  const submit = form.querySelector('[type="submit"]');
  const idleLabel = (submit?.querySelector("[data-submit-label]") || submit)?.textContent;
  let pending = false;
  let submitted = false;
  let fieldErrors = [];

  function clearFieldErrors() {
    for (const error of fieldErrors) {
      const firstField = form.elements.namedItem(error.names[0]);
      if (!firstField) continue;
      const errorId = `${firstField.id}-error`;
      document.getElementById(errorId)?.remove();
      for (const name of error.names) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        field.removeAttribute("aria-invalid");
        const descriptions = (field.getAttribute("aria-describedby") || "")
          .split(/\s+/).filter((id) => id && id !== errorId);
        if (descriptions.length) {
          field.setAttribute("aria-describedby", descriptions.join(" "));
        } else {
          field.removeAttribute("aria-describedby");
        }
      }
    }
  }

  function showFieldErrors(errors) {
    clearFieldErrors();
    fieldErrors = errors;
    for (const error of fieldErrors) {
      const firstField = form.elements.namedItem(error.names[0]);
      if (!firstField) continue;
      const inlineError = document.createElement("p");
      inlineError.id = `${firstField.id}-error`;
      inlineError.className = "affiliate-public__field-error";
      inlineError.textContent = error.message;
      firstField.after(inlineError);
      for (const name of error.names) {
        const field = form.elements.namedItem(name);
        if (!field) continue;
        field.setAttribute("aria-invalid", "true");
        const descriptions = (field.getAttribute("aria-describedby") || "")
          .split(/\s+/).filter(Boolean);
        descriptions.push(inlineError.id);
        field.setAttribute("aria-describedby", descriptions.join(" "));
      }
    }
    showError(errorEl, fieldErrors.length ? "Please check the highlighted fields below." : "");
  }

  function updateIntroductionCount() {
    if (!introCount) return;
    const introduction = form.elements.namedItem("introduction");
    introCount.textContent = `${String(introduction?.value || "").trim().length.toLocaleString("en-US")} / 1,000`;
  }

  form.addEventListener("input", (event) => {
    const name = event.target.name;
    if (fieldErrors.some((error) => error.names.includes(name))) {
      showFieldErrors(fieldErrors.filter((error) => !error.names.includes(name)));
    } else if (!fieldErrors.length) {
      showError(errorEl, "");
    }
    if (name === "introduction") updateIntroductionCount();
  });
  updateIntroductionCount();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // A disabled button alone does not stop repeated programmatic submissions.
    if (pending || submitted) return;

    const data = new FormData(form);
    const errors = validateForm(data);
    showFieldErrors(errors);
    if (errors.length) {
      form.elements.namedItem(errors[0].names[0])?.focus();
      return;
    }

    pending = true;
    setBusy(submit, true, idleLabel);
    if (statusEl) statusEl.textContent = "Sending application…";
    try {
      const response = await fetch("/api/affiliate/application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadFromForm(data)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to send your application right now.");
      }
      submitted = true;
      showSuccess({ form, successEl });
      updateIntroductionCount();
    } catch (error) {
      showError(
        errorEl,
        `${error?.message || "Unable to send your application right now."} Your entries are still here. Please try again.`,
      );
      errorEl?.focus();
    } finally {
      pending = false;
      setBusy(submit, false, idleLabel);
      if (statusEl) statusEl.textContent = "";
    }
  });
}

bindAffiliateApplicationForm();
