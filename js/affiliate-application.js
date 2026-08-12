const SOCIAL_FIELDS = ["instagram", "tiktok", "youtube", "website", "otherSocial"];

function fieldValue(form, name) {
  return String(form.get(name) || "").trim();
}

function hasSocialProfile(form) {
  return SOCIAL_FIELDS.some((name) => fieldValue(form, name));
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

function showError(errorEl, message) {
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
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
    successEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function validateForm(form) {
  const displayName = fieldValue(form, "displayName");
  if (displayName.length < 2 || displayName.length > 80) {
    return "Name must be between 2 and 80 characters.";
  }

  const email = fieldValue(form, "email").toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Please enter a valid email address.";
  }

  if (!hasSocialProfile(form)) {
    return "Please share at least one social profile or website.";
  }

  for (const name of SOCIAL_FIELDS) {
    if (fieldValue(form, name).length > 300) {
      return "Social and profile links must be 300 characters or fewer.";
    }
  }

  const introduction = fieldValue(form, "introduction");
  if (introduction.length < 20 || introduction.length > 1000) {
    return "Please tell us a little about yourself in 20 to 1,000 characters.";
  }

  return null;
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
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    showError(errorEl, "");

    const data = new FormData(form);
    const validationMessage = validateForm(data);
    if (validationMessage) {
      showError(errorEl, validationMessage);
      return;
    }

    setBusy(submit, true);
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
      showSuccess({ form, successEl });
    } catch (error) {
      showError(
        errorEl,
        error?.message || "Unable to send your application right now.",
      );
    } finally {
      setBusy(submit, false);
    }
  });
}

bindAffiliateApplicationForm();
