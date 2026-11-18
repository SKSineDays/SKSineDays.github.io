# Browser privacy choices

The app's optional Vercel page-view analytics, affiliate-link memory, and day-photo history default off. Login/session handling, account settings and service-worker caches are unchanged. Preferences are browser/origin-specific (`sineday:privacy:v1`, 180 days); blog preferences are separate. This is a technical control, not a guarantee of legal compliance in every jurisdiction.

The controller holds a current URL referral in memory until permission, captures it on acceptance (including another tab's consent change), and never returns a stored code to checkout without current referral permission. Reject/withdraw clear only named optional keys. Manual checkout-code entry remains available. Without storage permission, remembered attribution is not promised.

Photo storage is gated at each read/write. Accepting after a photo is visible persists the same index, without changing the picture. Withdrawal cannot be undone by a later rerender. Analytics loads only after opt-in, filters to pageviews and removes URL query/hash. Its beforeSend callback rechecks permission; withdrawal also reloads the document to remove provider listeners. Necessary auth keys are not cleared. Previously sent events/account records cannot be recalled by withdrawal.

Privacy choices are reachable in the footer. First-visit panel is nonmodal and may be dismissed without accepting; defaults stay denied. Equal accept/reject controls and per-purpose checkboxes are provided. Invalid, expired and future preference records fail closed. Storage-blocked choices apply only to the current page. Service-worker cache is bumped to v52 and precaches privacy modules. Already-open old-version tabs must refresh to run the new policy.

## Verification

- `node --test test/privacy*.test.mjs test/day-photo-selection.test.mjs test/day-photo-view.test.mjs test/vercel-analytics.test.mjs test/affiliate-ui-syntax.test.mjs test/guest-birthdate-retention.test.mjs`
- `npm test` on complete checkout.
- `node test/privacy-browser-smoke.cjs`: Chromium, 375/1440 widths, actual consent UI and photo/affiliate modules; mock Supabase and analytics provider to avoid real accounts/events. Includes sign-in form continuity, default-deny, accept/reject, withdraw/reload, auth-key preservation, query redaction, Escape/focus and screenshots.
- `.github/workflows/privacy-consent.yml` runs full tests + browser regression on PR. Existing affiliate review remains in place.

The smoke test is not a live OAuth/Stripe transaction or a jurisdictional legal review. Before publishing, inspect exact-head CI and preview; coordinate with the blog privacy release. No age policy or age-access change is included.
