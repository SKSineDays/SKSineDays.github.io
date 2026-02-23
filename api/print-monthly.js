import { authenticateUser, getAdminClient, requirePremium } from "./_lib/auth.js";
import { renderMonthPdf } from "./_lib/calendar-pdf.js";
import { hasTemplatesForYear } from "./_lib/premium-templates.js";
import { extractMonthlyFromTemplate } from "./_lib/template-pdf.js";
import { getOriginTypeForDob } from "../shared/origin-wave.js";
import { isRtlLocale } from "../shared/i18n.js";

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

function pad2(n) {
  return String(n).padStart(2, "0");
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

    const year = Number(body?.year);
    const month = Number(body?.month);
    const weekStart = body?.weekStart === 1 ? 1 : 0;
    const locale = typeof body?.locale === "string" ? body.locale : "en-US";
    const profileId = String(body?.profileId || "");

    if (!year || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, error: "Invalid year/month" });
    }
    if (!profileId) return res.status(400).json({ ok: false, error: "Missing profileId" });

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("id, display_name, birthdate")
      .eq("user_id", user.id)
      .eq("id", profileId)
      .maybeSingle();

    if (pErr || !profile) return res.status(404).json({ ok: false, error: "Profile not found" });

    let pdfBytes;
    let source = "render";
    const originDay = getOriginTypeForDob(profile.birthdate);
    const rtl = isRtlLocale(locale);

    if (!rtl && originDay && hasTemplatesForYear(year)) {
      pdfBytes = await extractMonthlyFromTemplate({
        admin,
        year,
        month,
        originDay,
        profileDisplayName: profile.display_name || "",
        userMark: user.email || user.id,
        locale
      });
      if (pdfBytes) source = "template";
    }
    if (!pdfBytes) {
      pdfBytes = await renderMonthPdf({
        year,
        monthIndex: month - 1,
        locale,
        weekStart,
        profiles: [profile],
        titleSuffix: profile.display_name || "",
        userMark: user.email || user.id,
        origin: getRequestOrigin(req)
      });
    }

    const bucket = "prints";
    const safeLocale = String(locale).replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 20);
    const filePath = `monthly/${user.id}/${profile.id}/${year}-${pad2(month)}-ws${weekStart}-loc${safeLocale}.pdf`;

    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const expiresIn = 60 * 10;
    const { data: signed, error: sErr } = await admin.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);

    if (sErr || !signed?.signedUrl) throw new Error("Failed to create signed URL");

    res.setHeader("x-sineday-source", source);
    return res.status(200).json({ ok: true, url: signed.signedUrl, expiresIn });
  } catch (err) {
    if (err?.code === "PREMIUM_REQUIRED") {
      return res.status(402).json({ ok: false, error: "Premium required" });
    }
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
