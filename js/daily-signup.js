let eligibilityScreened = false;
let ageEnabled = true;
let rolloutReady = false;
const form = document.getElementById("daily-signup");
const emailInput = document.getElementById("daily-email");
const birthdateInput = document.getElementById("daily-birthdate");
const timezoneInput = document.getElementById("daily-timezone");
const timezoneList = document.getElementById("daily-timezone-list");
const countryInput = document.getElementById("daily-country");
const consentInput = document.getElementById("daily-consent");
const submitButton = document.getElementById("daily-submit");
const status = document.getElementById("daily-form-status");

const source = new URLSearchParams(window.location.search).get("source") === "homepage-banner"
  ? "homepage-banner"
  : "public-daily-page";

function localTodayYmd() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function detectedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

function populateTimeZones() {
  let zones = [];
  try {
    zones = typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) {
    zones = [
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/New_York",
      "Europe/London",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Pacific/Honolulu"
    ];
  }
  const fragment = document.createDocumentFragment();
  for (const zone of zones) {
    const option = document.createElement("option");
    option.value = zone;
    fragment.append(option);
  }
  timezoneList?.replaceChildren(fragment);
}

function isValidTimeZone(value) {
  if (!value || value !== value.trim()) return false;
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone: value }));
  } catch {
    return false;
  }
}

function isRealBirthdate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    value <= localTodayYmd()
  );
}

function errorElementFor(input) {
  return document.getElementById(`${input.id}-error`);
}

function setFieldError(input, message = "") {
  const error = errorElementFor(input);
  if (error) error.textContent = message;
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function setStatus(message = "", tone = "") {
  if (!status) return;
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

function validate() {
  let firstInvalid = null;
  const email = emailInput.value.trim();
  if (
    eligibilityScreened && (!email ||
    email.length > 320 ||
    !emailInput.validity.valid)
  ) {
    setFieldError(emailInput, "Enter a valid email address.");
    firstInvalid ||= emailInput;
  } else {
    setFieldError(emailInput);
  }

  if (!isRealBirthdate(birthdateInput.value)) {
    setFieldError(birthdateInput, "Enter a real birthdate that is not in the future.");
    firstInvalid ||= birthdateInput;
  } else {
    setFieldError(birthdateInput);
  }

  if (eligibilityScreened && !isValidTimeZone(timezoneInput.value)) {
    setFieldError(timezoneInput, "Enter a valid IANA time zone, such as America/Chicago.");
    firstInvalid ||= timezoneInput;
  } else {
    setFieldError(timezoneInput);
  }

  if (ageEnabled && !countryInput?.value) {
    setFieldError(countryInput, "Choose your country of residence.");
    firstInvalid ||= countryInput;
  } else setFieldError(countryInput);

  if (eligibilityScreened && !consentInput.checked) {
    setFieldError(consentInput, "Please check the consent box to continue.");
    firstInvalid ||= consentInput;
  } else {
    setFieldError(consentInput);
  }

  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }
  return true;
}

for (const input of [emailInput, birthdateInput, timezoneInput, countryInput, consentInput]) {
  input?.addEventListener("input", () => setFieldError(input));
  input?.addEventListener("change", () => setFieldError(input));
}

birthdateInput.max = localTodayYmd();
timezoneInput.value = detectedTimeZone();
populateTimeZones();

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!rolloutReady || submitButton.disabled || !validate()) return;

  if (!eligibilityScreened) {
    submitButton.disabled = true;
    const screenedBirthdate = birthdateInput.value;
    const screenedCountry = countryInput.value;
    try {
      const response = await fetch("/api/mailer-signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screen", birthdate: screenedBirthdate, country: screenedCountry })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Eligibility could not be checked.");
      if (birthdateInput.value !== screenedBirthdate || countryInput.value !== screenedCountry) return;
      eligibilityScreened = true;
      for (const section of document.querySelectorAll("[data-email-step]")) section.hidden = false;
      submitButton.textContent = "Send me my daily SineDay";
      setStatus("Now choose where to receive your daily emails.");
      emailInput.focus();
    } catch (error) { setStatus(error.message || "Eligibility could not be checked.", "error"); }
    finally { submitButton.disabled = false; }
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Sending confirmation…";
  form.setAttribute("aria-busy", "true");
  setStatus("Preparing your confirmation email…");

  try {
    const response = await fetch("/api/mailer-signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        birthdate: birthdateInput.value,
        country: countryInput.value,
        timezone: timezoneInput.value,
        consent: consentInput.checked,
        company: form.elements.company.value,
        source
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ||
        (response.status === 503
          ? "You appear to be offline. Reconnect and try again."
          : "We could not start signup. Please try again.")
      );
    }

    // Birthdate remains transient: remove it immediately after acceptance.
    birthdateInput.value = "";
    consentInput.checked = false;
    setStatus(data.message, "success");
  } catch (error) {
    setStatus(error.message || "We could not start signup. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send me my daily SineDay";
    form.removeAttribute("aria-busy");
  }
});

submitButton.disabled = true;
// No implicit country default: a timezone is not a jurisdiction declaration.
fetch("/api/config", { cache: "no-store" }).then(async response => {
  const config = await response.json();
  if (!response.ok || !config.ok) throw new Error();
  ageEnabled = config.mailerEligibilityEnabled === true;
  countryInput.closest('.daily-field').hidden = !ageEnabled;
  countryInput.required = ageEnabled;
  if (!ageEnabled) {
    eligibilityScreened = true;
    for (const section of document.querySelectorAll("[data-email-step]")) section.hidden = false;
    submitButton.textContent = "Send me my daily SineDay";
  } else {
    response = await fetch("/api/eligibility-policy", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.countries)) throw new Error();
    for (const country of data.countries) {
      const option = document.createElement("option");
      option.value = country.code; option.textContent = country.name;
      countryInput?.append(option);
    }
  }
  rolloutReady = true; submitButton.disabled = false;
}).catch(() => setStatus("Signup is temporarily unavailable. Please try again later.", "error"));

for (const input of [birthdateInput, countryInput]) {
  input?.addEventListener("input", () => {
    if (!ageEnabled) return;
    eligibilityScreened = false;
    for (const section of document.querySelectorAll("[data-email-step]")) section.hidden = true;
    emailInput.value = ""; consentInput.checked = false;
    submitButton.textContent = "Continue";
  });
}
window.addEventListener("pagehide", () => { birthdateInput.value = ""; });
