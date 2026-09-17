/**
 * Account sheet: personal journal data download (Free + Premium).
 */

import { getAccessToken } from "./supabase-client.js";

const DOWNLOAD_BTN_ID = "download-data-btn";
const STATUS_ID = "data-export-status";

const DEFAULT_LABEL = "Download Data";
const BUSY_LABEL = "Preparing…";

const MSG_SUCCESS = "Your SineDay data has been downloaded.";
const MSG_GENERIC_ERROR = "We couldn't prepare your data download. Please try again.";
const MSG_SESSION_EXPIRED = "Your session expired. Sign in again to download your data.";

function exportFilenameDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function setStatus(el, text, { isError = false } = {}) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
  el.classList.toggle("is-success", !!text && !isError);
}

function setButtonBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
  button.textContent = busy ? BUSY_LABEL : DEFAULT_LABEL;
}

async function downloadJournalExport() {
  const button = document.getElementById(DOWNLOAD_BTN_ID);
  const status = document.getElementById(STATUS_ID);
  if (!button) return;

  setStatus(status, "");
  setButtonBusy(button, true);

  try {
    const token = await getAccessToken();
    if (!token) {
      setStatus(status, MSG_SESSION_EXPIRED, { isError: true });
      return;
    }

    let response;
    try {
      response = await fetch("/api/export-journal-data", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      setStatus(status, MSG_GENERIC_ERROR, { isError: true });
      return;
    }

    if (response.status === 401) {
      setStatus(status, MSG_SESSION_EXPIRED, { isError: true });
      return;
    }

    if (!response.ok) {
      setStatus(status, MSG_GENERIC_ERROR, { isError: true });
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      setStatus(status, MSG_GENERIC_ERROR, { isError: true });
      return;
    }

    if (payload?.format !== "sineday-journal-export" || !Array.isArray(payload.entries)) {
      setStatus(status, MSG_GENERIC_ERROR, { isError: true });
      return;
    }

    const jsonText = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonText], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `sineday-journal-data-${exportFilenameDate()}.json`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    setStatus(status, MSG_SUCCESS);
  } catch {
    setStatus(status, MSG_GENERIC_ERROR, { isError: true });
  } finally {
    setButtonBusy(button, false);
  }
}

function initDataExport() {
  const button = document.getElementById(DOWNLOAD_BTN_ID);
  if (!button || button.dataset.exportBound === "true") return;
  button.dataset.exportBound = "true";
  button.addEventListener("click", () => {
    downloadJournalExport();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDataExport);
} else {
  initDataExport();
}
