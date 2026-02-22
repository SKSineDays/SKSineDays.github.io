import { authenticateUser, getAdminClient, requirePremium } from "./_lib/auth.js";
import { renderWeekPdf } from "./_lib/calendar-pdf.js";
import { extractWeeklyFromTemplate } from "./_lib/template-pdf.js";
import { getOriginTypeForDob } from "../shared/origin-wave.js";

function getRequestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function addDaysUTC(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function startOfWeekUTC(date, weekStart) {
  const dow = date.getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return addDaysUTC(date, -delta);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { user } = await authenticateUser(req);
    const admin = getAdminClient();
    await requirePremium(admin, user.id);

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const locale = typeof body?.locale === "string" ? body.locale : "en-US";
    const weekStart = body?.weekStart === 1 ? 1 : 0;
    const profileId = String(body?.profileId || "");

    const anchorYmd = typeof body?.anchorYmd === "string" ? body.anchorYmd : null;
    const anchor = anchorYmd
      ? new Date(Date.UTC(Number(anchorYmd.slice(0, 4)), Number(anchorYmd.slice(5, 7)) - 1, Number(anchorYmd.slice(8, 10)), 12))
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 12));

    const weekStartDateUTC = startOfWeekUTC(anchor, weekStart);
    const startYmd = ymdUTC(weekStartDateUTC);

    if (!profileId) return res.status(400).json({ ok: false, error: "Missing profileId" });

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("id, display_name, birthdate")
      .eq("user_id", user.id)
      .eq("id", profileId)
      .maybeSingle();

    if (pErr || !profile) return res.status(404).json({ ok: false, error: "Profile not found" });

    let pdfBytes;
    const originDay = getOriginTypeForDob(profile.birthdate);

    if (originDay) {
      pdfBytes = await extractWeeklyFromTemplate({
        admin,
        startYmd,
        weekStart,
        originDay,
        profileDisplayName: profile.display_name || "",
        userMark: user.email || user.id,
        locale
      });
    }
    if (!pdfBytes) {
      pdfBytes = await renderWeekPdf({
        startYmd,
        locale,
        profiles: [profile],
        titleSuffix: profile.display_name || "",
        userMark: user.email || user.id,
        origin: getRequestOrigin(req)
      });
    }

    const bucket = "prints";
    const safeLocale = String(locale).replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 20);
    const filePath = `weekly/${user.id}/${profile.id}/${startYmd}-ws${weekStart}-loc${safeLocale}.pdf`;

    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const expiresIn = 60 * 10;
    const { data: signed, error: sErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);

    if (sErr || !signed?.signedUrl) throw new Error("Failed to create signed URL");

    return res.status(200).json({ ok: true, url: signed.signedUrl, expiresIn, startYmd });
  } catch (err) {
    if (err?.code === "PREMIUM_REQUIRED") {
      return res.status(402).json({ ok: false, error: "Premium required" });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
