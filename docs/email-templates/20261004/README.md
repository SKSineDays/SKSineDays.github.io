# Daily mailers: blog invitation and shorter mySine — 2026-10-04

Draft copy for all 18 production daily aliases. No templates are published by the generator or tests. Welcome and Confirmation are outside this change.

## Content and hierarchy

- Each day's original reflection question stays distinct. The two long explanatory paragraphs are removed, the open-ended caveat is kept word for word, and the reply invitation becomes one short line.
- The existing dashboard button remains the primary action.
- A secondary blog invitation follows it: “A little more room to reflect” / “Small observations and open questions from the SineDay Journal.” / “Explore the SineDay blog”. The link uses `https://www.sineday.blog/`, has no tracking parameters, and explicitly disables click tracking.
- Official daily scene and wave images, preheaders, guidance, “Notice today,” dashboard CTA, private-reply promise, and unsubscribe markup stay unchanged.
- The dark canvas, presentation tables, inline styles, 520px fluid layout, and Outlook fallbacks stay intact. Language/direction also live on the outer table for clients that remove the document root.

## One source for both formats

Edit `copy.json`, then run:

```sh
node scripts/generate-daily-email-copy.mjs
node scripts/generate-daily-email-copy.mjs --check
npm test
npm run test:daily-email-copy:browser
```

The generator reads the immutable `20260924` baseline and writes these 18 HTML/plain-text pairs plus the hash manifest. It fails if required sections are absent or duplicated. Do not hand-edit the generated files, mutate historical snapshots, or run the unrelated premium-calendar generator for mailers.

The temporary hosted viewer has been removed. Use the automated offline browser check to review every day at 320, 375, or 520 pixels. The automated browser check uses installed Playwright Chromium, or the explicit `MAILER_BROWSER_EXECUTABLE` path, and writes its screenshots/report to `/tmp/sineday-daily-copy-preview` by default (`--output` selects another folder). Its 108 renders cover all 18 days at three widths in light/dark preference, plus 18 image-blocked checks. All requests are intercepted and the existing official image bytes are read locally; it sends nothing to production.

## Publication gate

This snapshot is a review draft. Repository merge/deployment and publication to live Resend aliases require approval. A repository merge alone does not update Resend's stored templates.

After approval, fetch and retain a fresh rollback copy of all 18 live templates. Check for live drift against the `previous_*_sha256` fields (Resend omits the repository HTML's final newline). Update only `html` and `text` on the existing aliases, then publish and re-fetch each template. Do not create replacements or rename aliases, including the existing `-1` suffixes. Preserve subject, sender `Daily <daily@daily.sineday.app>`, Reply-To `mysine@sineday.app`, the `OPT_OUT_URL` string variable and fallback, and all sending/domain settings. Verify both formats against this manifest after the service's newline normalization. Stop if any non-content metadata changes.

Existing calculations, daily dispatch, scheduling, unsubscribe handlers, authentication, tracking settings, and privacy behavior are outside this patch. Do not send subscriber or test emails without specific authorization. Browser renders validate the HTML layout; they do not substitute for native Gmail/Apple Mail/Outlook inbox tests.
