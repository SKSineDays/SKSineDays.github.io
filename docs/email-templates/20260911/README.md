# Archived SineDay custom HTML mailers

Superseded by [the 20260923 production sources](../20260923/README.md). Retained for historical provenance and previously delivered emails; do not republish these sources.

Welcome and all 18 daily emails, approved by the owner for publication on 2026-09-11. These files are Resend template source, not app runtime code.

The 36 raster assets live at `/assets/email/20260911/`: one day-specific landscape/official-SineDuck composition and one static wave-position PNG per day. Welcome reuses Day 15 artwork. Source and output hashes are in `asset-manifest.json`. The original app landscapes and SVGs are unchanged.

Keep the existing aliases in `api/_lib/daily-email.js`; Welcome stays `welcomeemail`. Sender remains `Daily <daily@daily.sineday.app>`, Reply-To remains `mysine@sineday.app`, and the sole template variable is `OPT_OUT_URL`. Keep current subjects. Update existing Resend templates with matching HTML and plain text, then publish. Do not rename aliases or modify the mailer engine.

Primary links open `https://sineday.app/dashboard.html`. Existing authentication handles signed-out visitors. This link does not force a journal page or change the active profile.

The HTML sources are authored dark. Do not declare `color-scheme: dark`; that invites Apple Mail to recolor an already-dark canvas. Templates declare `color-scheme: light only` so native clients leave SineDay’s explicit dark surfaces and white SineDuck plate as written. There is no alternate light theme.

Welcome includes a secondary Add SineDay to Contacts action linking to the public vCard at `/assets/email/sineday-daily.vcf` (`daily@daily.sineday.app`). Do not add that action to the daily templates.

Run `npm run audit:daily-email-templates` after publishing. Preserve its required markers, background fallbacks, dark-canvas lock, literal SineDuck filename identity, unsubscribe variable, and Welcome contact-card URL.
