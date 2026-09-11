# Approved SineDay custom HTML mailers

Welcome and all 18 daily emails, approved by the owner for publication on 2026-09-11. These files are Resend template source, not app runtime code.

The 36 raster assets live at `/assets/email/20260911/`: one day-specific landscape/official-SineDuck composition and one static wave-position PNG per day. Welcome reuses Day 15 artwork. Source and output hashes are in `asset-manifest.json`. The original app landscapes and SVGs are unchanged.

Keep the existing aliases in `api/_lib/daily-email.js`; Welcome stays `welcomeemail`. Sender remains `Daily <daily@daily.sineday.app>`, Reply-To remains `mysine@sineday.app`, and the sole template variable is `OPT_OUT_URL`. Keep current subjects. Update existing Resend templates with matching HTML and plain text, then publish. Do not rename aliases or modify the mailer engine.

Primary links open `https://sineday.app/dashboard.html`. Existing authentication handles signed-out visitors. This link does not force a journal page or change the active profile.

Run the unchanged `npm run audit:daily-email-templates` after publishing. Preserve its required markers, background fallbacks, literal SineDuck filename identity and unsubscribe variable. Representative offline rendering covered Welcome and Days 1, 6, 14, 18 at 320/375/600px and with images blocked; native email-client dark-mode behavior was not independently verified.
