const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
let confirmationToken = hashParams.get("token") || "";
if (window.location.hash) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

const button = document.getElementById("daily-confirm-button");
const status = document.getElementById("daily-confirm-status");
const copy = document.getElementById("daily-confirm-copy");
const schedule = document.getElementById("daily-confirm-schedule");
const scheduleValue = document.getElementById("daily-confirm-schedule-value");

function setStatus(message = "", tone = "") {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

function showTerminalState(message) {
  button.hidden = true;
  copy.textContent = message;
  setStatus("");
}

function formatTime(hour, minute) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

if (!confirmationToken) {
  showTerminalState("This confirmation link is missing or incomplete. Start a fresh signup to receive a new link.");
}

button?.addEventListener("click", async () => {
  if (!confirmationToken || button.disabled) return;

  button.disabled = true;
  button.textContent = "Confirming…";
  setStatus("Confirming your Daily SineDay emails…");

  try {
    const response = await fetch("/api/mailer-confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: confirmationToken })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      if (["invalid", "expired", "already-used", "unavailable"].includes(data.state)) {
        confirmationToken = "";
        showTerminalState(
          data.error || "This confirmation link cannot be used. Start a fresh signup."
        );
        return;
      }
      throw new Error(data.error || "We could not confirm your signup. Please try again.");
    }

    confirmationToken = "";
    button.hidden = true;
    copy.textContent = "Your Daily SineDay emails are on. Welcome to your morning rhythm.";
    const time = formatTime(data.sendHourLocal, data.sendMinuteLocal);
    if (time && typeof data.timezone === "string" && data.timezone) {
      scheduleValue.textContent = `Around ${time} in ${data.timezone}`;
      schedule.hidden = false;
    }
    setStatus("Confirmed.", "success");
  } catch (error) {
    setStatus(error.message || "We could not confirm your signup. Please try again.", "error");
    button.disabled = false;
    button.textContent = "Confirm my daily emails";
  }
});

