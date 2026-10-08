# AI Changelog

This file tracks all changes made by AI during development of the SineDay Wave PWA.

Each entry includes:
- **Timestamp**: When the change was made (ISO format)
- **Files**: Which files were modified
- **Summary**: What was changed (1-2 lines)
- **Rationale**: Why the change was necessary
- **Notes/Risks**: Additional context or potential issues

---

## 2026-01-04T01:47:48.933Z

**Files:** ai/log-change.mjs, AI_CHANGELOG.md, ai/ai_changelog.jsonl

**Summary:** Set up changelog infrastructure with helper script and dual-format logs

**Rationale:** Required for tracking all AI changes throughout the project as specified in requirements


---

## 2026-01-04T01:50:07.600Z

**Files:** js/sineday-engine.js, js/wave-canvas.js, js/ui.js

**Summary:** Created modular JS architecture: SineDayEngine for calculations, WaveCanvas for visualization, UI for coordination

**Rationale:** Phase 0 refactoring: separate concerns, add validation, enable testability and maintainability

**Notes:** All calculation logic now pure functions. Wave animation includes breathing effect, reduced-motion support, and smooth marker transitions.

---

## 2026-01-04T01:51:59.379Z

**Files:** index.html, styles.css

**Summary:** Complete UI redesign: dark premium theme, glass morphism, animated wave canvas, responsive mobile-first layout

**Rationale:** Phase 1 implementation: transform basic form into native-feeling iPhone PWA with smooth animations and premium aesthetics

**Notes:** Uses CSS custom properties, safe-area insets for iOS, reduced-motion support, high-contrast mode. Background images fade in with blur effect.

---

## 2026-01-04T01:53:09.663Z

**Files:** README.md, script.js

**Summary:** Created comprehensive README with local setup, deployment, and feature extension guides. Removed legacy script.js.

**Rationale:** Documentation critical for project maintainability and onboarding. Old script.js replaced by modular architecture.

**Notes:** README includes GitHub Pages deployment steps, browser support, performance metrics, and contribution workflow.

---

## 2026-01-04T01:54:11.525Z

**Files:** manifest.json, service-worker.js, breathingicon.svg, ICONS_TODO.md

**Summary:** Added PWA manifest, service worker for offline support, and SVG icon template

**Rationale:** Phase 2 PWA functionality: enables install to home screen, offline caching, native app experience

**Notes:** Service worker uses cache-first for assets, network-first for HTML. Icons need PNG conversion (see ICONS_TODO.md).

---

## 2026-01-04T01:55:07.066Z

**Files:** manifest.json, index.html, generate-icons.py

**Summary:** Added SVG icon fallback and Python icon generator script for future PNG conversion

**Rationale:** PNG generation tools not available in environment; SVG provides functional fallback for PWA icons

**Notes:** generate-icons.py can be run later with Pillow installed, or use online tools per ICONS_TODO.md

---

## 2026-01-04T01:56:31.850Z

**Files:** all

**Summary:** Committed and pushed complete Phase 0, Phase 1, and Phase 2 (PWA) implementation to branch

**Rationale:** Deploy all changes to remote repository for review and GitHub Pages deployment


---

## 2026-01-06 - SineDuck Integration (Initial)

**Files:** js/sineducks.js (new), index.html, js/ui.js, styles.css

**Summary:** Integrated 18 SineDuck character images to display alongside SineDay results

**Rationale:** Add personalized duck mascot for each of the 18 SineDay numbers to enhance user experience and visual appeal

**Implementation Details:**
- Created `/js/sineducks.js` module with DUCK_URLS array and `duckUrlFromSinedayNumber(n)` helper function
- Added `<img id="todayDuck">` element to result card in `index.html`
- Imported and integrated duck display in `ui.js` displayResult() method
- Added `.duck-image` CSS styling (120px × 120px, centered, with drop shadow)
- Uses GitHub Pages-compatible relative paths: `assets/sineducks/SineDuck[1-18]@3x.png`

**Notes:** No changes to existing SineDay calculation logic. Duck image updates automatically when result is displayed. Maintains responsive design and glass-morphism aesthetic.

---

## 2026-01-06 - Bug Fix & Swipe Gesture

**Files:** assets/sineducks/ (new directory), index.html, js/ui.js, styles.css, all 18 SineDuck images

**Summary:** Fixed SineDuck image loading and added intuitive swipe-up gesture to clear results

**Bug Fix:**
- Moved SineDuck images from root directory to `assets/sineducks/` for proper organization
- Images now load correctly with relative paths compatible with GitHub Pages

**New Feature - Swipe Gesture:**
- Added touch event handlers (touchstart, touchmove, touchend) for swipe detection
- Swipe up on result card to clear and return to birthday input
- Visual feedback during swipe (opacity fade and position translation)
- Swipe hint indicator with animated pulse effect showing "Swipe up to try another date"
- Threshold of 80px upward swipe to trigger reset
- Prevents accidental triggers during horizontal scrolling
- Desktop fallback: click result card to return to input
- Wave marker resets to center position on clear

**Implementation Details:**
- Created `assets/sineducks/` directory and organized all 18 duck images
- Added touch gesture state tracking (touchStartY, touchStartX, isDragging)
- Implemented `handleTouchStart()`, `handleTouchMove()`, `handleTouchEnd()` methods
- Created `resetToInput()` method for clean state reset
- Added swipe-hint element with upward arrow SVG icon
- Styled swipe hint with pulse animation keyframes
- Passive event listeners for performance, with preventDefault on touchmove during swipe

**Notes:** Swipe gesture feels natural and intuitive on mobile. Desktop users can still click the card. No breaking changes to existing functionality.

---

## 2026-08-17T04:50:38.453Z

**Files:** api/_lib/affiliate.js, api/_lib/affiliate-server.js, api/create-checkout-session.js, api/stripe/webhook.js, api/affiliate/support.js, js/affiliate-ui.js, js/dashboard.js, supabase/migrations/20260815_affiliate_checkout_promotion_codes.sql

**Summary:** Move Affiliate attribution from post-purchase support codes to Stripe Checkout Promotion Codes.

**Rationale:** Customers need to see the mkdir -p /opt/cursor/artifacts && npm test > /opt/cursor/artifacts/affiliate_checkout_test_output.log 2>&1 && tail -20 /opt/cursor/artifacts/affiliate_checkout_test_output.log && node ai/log-change.mjs --files "api/_lib/affiliate.js,api/_lib/affiliate-server.js,api/create-checkout-session.js,api/stripe/webhook.js,api/affiliate/support.js,js/affiliate-ui.js,js/dashboard.js,supabase/migrations/20260815_affiliate_checkout_promotion_codes.sql" --summary "Move Affiliate attribution from post-purchase support codes to Stripe Checkout Promotion Codes." --rationale "Customers need to see the $1 monthly Affiliate discount before paying, and SineDay needs durable attribution from the Checkout Promotion Code rather than a seven-day backfill." --notes "One master coupon plus one Promotion Code per active Affiliate. Existing Connect, payout, and commission hold behavior is unchanged." monthly Affiliate discount before paying, and SineDay needs durable attribution from the Checkout Promotion Code rather than a seven-day backfill.

**Notes:** One master coupon plus one Promotion Code per active Affiliate. Existing Connect, payout, and commission hold behavior is unchanged.

---

## 2026-09-30T23:00:41.089Z

**Files:** api/_lib/globe-auth.js, api/globe/groups.js, api/globe/me.js, assets/globe/SOURCES.md, assets/globe/earth-july-2004.jpg, assets/globe/earth-still.webp, assets/vendor/three-r180/LICENSE, assets/vendor/three-r180/README.md, assets/vendor/three-r180/three.core.min.js, assets/vendor/three-r180/three.module.min.js, css/dashboard.css, dashboard.html, docs/globe/IMPLEMENTATION.md, docs/globe/after-desktop.png, docs/globe/after-landscape.png, docs/globe/after-mobile.png, docs/globe/after-small-mobile.png, docs/globe/asset-costs.json, docs/globe/before-desktop.png, docs/globe/before-mobile.png, docs/globe/browser-results.json, docs/globe/credits.html, docs/globe/dashboard-mobile.png, docs/globe/dashboard-results.json, docs/globe/pwa-results.json, js/dashboard.js, js/duck-carousel.js, js/globe-points.js, js/globe-renderer.js, js/origin-globe.js, package-lock.json, package.json, privacy.html, scripts/generate-globe-catalog.py, scripts/prepare-earth-assets.py, service-worker.js, shared/globe-regions.js, supabase/migrations/20260930172350_globe_memberships.sql, test/affiliate-support-route.test.mjs, test/day-artwork.test.mjs, test/globe-browser-smoke.cjs, test/globe-dashboard-smoke.cjs, test/globe-database.test.mjs, test/globe-points.test.mjs, test/globe-routes.test.mjs, test/globe-service-worker-smoke.cjs, test/public-daily-page.test.mjs, test/sineduck-intro.test.mjs, test/vercel-analytics.test.mjs

**Summary:** Replace the Origin ambient sphere with a real local 3D Earth and optional account lights.

**Rationale:** Preserve official duck presentation and private profile boundaries while adding coarse explicit-consent membership, owner RLS, authenticated SQL aggregation, lifecycle controls and mobile-budget rendering.

**Notes:** Main reinspected at 678a68a. 38 focused database/API/existing assertions and local carousel/dashboard/PWA smoke checks pass. NASA map and Three.js r180 are credited and locally served. Migration remains unapplied; hosted member flow, deployed latency/assets and physical iPhone/iOS PWA validation remain release gates. Includes narrow pointer-capture/native-image-drag fixes found in interaction verification.

---

## 2026-10-01T15:30:22.121Z

**Files:** api/globe/me.js, api/globe/groups.js, js/origin-globe.js, js/globe-points.js, js/globe-renderer.js, js/duck-carousel.js, css/dashboard.css, shared/globe-cities.js, shared/globe-regions.js, supabase/migrations/20261001150055_globe_city_memberships.sql, assets/globe/city-supplements.json, assets/globe/earth-still.webp, assets/globe/SOURCES.md, scripts/generate-globe-catalog.py, scripts/prepare-earth-assets.py, dashboard.html, js/dashboard.js, privacy.html, service-worker.js, docs/globe, test/globe-*

**Summary:** Refine Origin Earth profile centering, optional city lights and soft sunlight.

**Rationale:** Tie unchanged private profile artwork to the Earth geometry; allow explicitly consented public city anchors while preserving legacy country-only membership, owner RLS and anonymous aggregation.

**Notes:** Current main and live Supabase #105 schema inspected read-only. 31 focused unit/regression tests and carousel/dashboard/v34-to-v35 worker smoke passed locally, including city catalog failure/retry and touch/keyboard selection. New forward migration remains unapplied; Stephen must apply only 20261001150055_globe_city_memberships.sql before merging/deploying and perform physical iPhone visual QA. No production test accounts or writes.

---

## 2026-10-03T23:07:58.322Z

**Files:** index.html, styles.css, login.html, test/homepage-dashboard-invitation.test.mjs

**Summary:** Invite visitors into the dashboard and welcome new and returning users at sign-in.

**Rationale:** Explain the dashboard before the main call to action while keeping Premium expectations clear and reusing the existing intro in both calculator states.

**Notes:** Focused copy, placement, daily-email and SineDuck source checks pass (11 tests). UI and auth JavaScript are unchanged. Cloud browser could not open the local preview (ERR_BLOCKED_BY_CLIENT); browser layout and live OAuth were not verified.

---

## 2026-10-04T23:58:30.706Z

**Files:** scripts/generate-daily-email-copy.mjs, scripts/verify-daily-email-copy.mjs, docs/email-templates/20261004, package.json, test/daily-email-copy.test.mjs

**Summary:** Prepare all 18 daily mailers with a shorter mySine reflection and a secondary SineDay blog invitation

**Rationale:** Reduce repeated reading burden while preserving each day’s own reflection question and keeping daily guidance primary

**Notes:** Draft only: historical snapshot and all live Resend aliases remain unchanged. Shared copy regenerates all HTML/text pairs. Exact preservation, parity, hashes and contrast covered by tests. Browser/inbox rendering requires separate verification before live publication.

---

## 2026-10-05T00:47:05.915Z

**Files:** scripts/generate-daily-editorial-copy.mjs, scripts/verify-daily-email-copy.mjs, docs/email-templates/20261005, package.json, test/daily-editorial-copy.test.mjs

**Summary:** Prepare a coherent perspective and writing invitation for every daily SineDay email

**Rationale:** Give each canonical day one clear point across subtitle, preheader, narrative, observation and writing, with ordinary scenes and room for real or imagined stories

**Notes:** Review only. All 18 HTML/text pairs generated from the immutable 20261004 published baseline. mySine stays 39–43 words; titles, phases, assets, wave, subjects, aliases, CTA, blog, privacy and unsubscribe remain intact. All 274 tests pass with zero skips, both snapshot checks pass, and all 54 WeasyPrint static renders at 320/375/520px show full copy without text overflow. All 18 mobile preview pages visually inspected. Browser and native inbox rendering have not been run for this revision. No push, merge, hosted preview, Resend update or email send is included.

---

## 2026-10-05T01:07:48.687Z

**Files:** scripts/generate-daily-editorial-copy.mjs, test/daily-editorial-copy.test.mjs, docs/email-templates/20261005/README.md, docs/email-templates/20261005/day-01.html, docs/email-templates/20261005/day-02.html, docs/email-templates/20261005/day-03.html, docs/email-templates/20261005/day-04.html, docs/email-templates/20261005/day-05.html, docs/email-templates/20261005/day-06.html, docs/email-templates/20261005/day-07.html, docs/email-templates/20261005/day-08.html, docs/email-templates/20261005/day-09.html, docs/email-templates/20261005/day-10.html, docs/email-templates/20261005/day-11.html, docs/email-templates/20261005/day-12.html, docs/email-templates/20261005/day-13.html, docs/email-templates/20261005/day-14.html, docs/email-templates/20261005/day-15.html, docs/email-templates/20261005/day-16.html, docs/email-templates/20261005/day-17.html, docs/email-templates/20261005/day-18.html, docs/email-templates/20261005/template-manifest.json

**Summary:** Move the daily editorial root canvas lock inline for Resend template compatibility

**Rationale:** The current template update contract excludes style elements; retain the existing light-only declaration on the same HTML root without changing reader copy or other shell bytes

**Notes:** All 18 HTML files differ only by removal of the exact inherited root style block and insertion of its declaration on the html element. Source copy, all text alternatives, body/meta locks, identities, assets, links, and historical snapshots remain byte-identical. Missing, duplicate, or unexpected style/root markup fails closed. Both generation checks and all 275 tests pass with zero skips. No push, commit, merge, publish or email send performed by this compatibility patch. Compatibility static QA passes all 54 day/width renders; all 18 new mobile PNGs are pixel-and-byte identical to the pre-change previews.

---

## 2026-10-05T16:16:09.255Z

**Files:** docs/email-templates/20261005-card-aligned, scripts/generate-card-aligned-mailers.mjs, scripts/verify-card-aligned-mailers.mjs, test/card-aligned-mailers.test.mjs, package.json

**Summary:** Align all 18 daily mailers exactly with the website cards and add personal wave questions

**Rationale:** Preserve the canonical card subtitles, paragraphs and bullets in email while giving each day one focused reflection question.

**Notes:** Adds a deterministic HTML and plain-text snapshot, manifest, provenance and responsive preview. All 300 tests and all three snapshot generation checks pass. New list items declare explicit inline typography for email compatibility. Website source, historical snapshots, email identities, images, destinations and delivery behavior remain unchanged. Hosted browser checks are required before publication.

---

## 2026-10-05T16:47:29.666Z

**Files:** docs/email-templates/20261004/preview.html, docs/email-templates/20261005/preview.html, docs/email-templates/20261005-card-aligned/preview.html, scripts/generate-card-aligned-mailers.mjs, scripts/verify-card-aligned-mailers.mjs, test/card-aligned-mailers.test.mjs, docs/email-templates/20261004/README.md, docs/email-templates/20261005/README.md, docs/email-templates/20261005-card-aligned/README.md

**Summary:** Remove temporary hosted email review viewers

**Rationale:** The review is finished; remove all three temporary viewer entrypoints while preserving actual email templates and delivery.

**Notes:** The generator no longer writes preview.html. Offline browser tests construct the viewer in memory. Email HTML/TXT, manifests, IDs, aliases, public image assets, app code and cron are byte-identical. Three snapshot checks pass. Browser launch is blocked by this executor socket sandbox.

---

## 2026-10-06T18:16:45.242Z

**Files:** affiliate.html, css/affiliate-public.css, js/affiliate-application.js, test/affiliate-public-page.test.mjs, test/affiliate-application-feedback.test.mjs, test/affiliate-public-browser-smoke.cjs

**Summary:** Refine the affiliate invitation and application experience with a page-scoped editorial layout, clearer program copy, and accessible submission feedback.

**Rationale:** Make the working anonymous affiliate application easier to understand and use while preserving API, validation, approval, payout, and legal behavior.

**Notes:** Official SineDuck asset unchanged; commission wording now includes first qualifying paid monthly invoice as already defined in terms. No dashboard, backend, legal terms, or global style changes.

---

## 2026-10-06T18:33:27.375Z

**Files:** affiliate.html, css/affiliate-public.css, test/affiliate-public-page.test.mjs, test/affiliate-public-browser-smoke.cjs

**Summary:** Replace font-dependent affiliate arrow glyphs with decorative inline SVGs.

**Rationale:** Prevent missing-glyph boxes in browsers whose installed fonts omit the arrow characters.

**Notes:** All five arrows are 16px, aria-hidden and non-focusable; labels, destinations, keyboard focus, submit loading behavior and API code stay unchanged. Syntax and 83 affiliate / 317 full tests pass with declared dependencies. Offline browser assertions cover icon geometry and pending-submit hiding but Chromium launch remains blocked by the executor socket sandbox, including after reviewed escalation. Draft-only follow-up; no merge or manual deployment.

---

## 2026-10-06T18:56:00.825Z

**Files:** affiliate.html, css/affiliate-public.css, test/affiliate-public-page.test.mjs, test/affiliate-public-browser-smoke.cjs

**Summary:** Make the affiliate page concise and information-first, removing decorative microheaders and promotional framing.

**Rationale:** Apply the request for a restrained, detailed and informative application page.

**Notes:** Program facts and disclosures are retained. No application JavaScript, backend, legal terms, shared styles, or artwork changes. Form is first in mobile reading order; official artwork is small and unframed on desktop.

---

## 2026-10-08T03:34:49.009Z

**Files:** accessibility.html, affiliate-terms.html, affiliate.html, contact.html, daily-confirm.html, daily.html, dashboard.html, index.html, login.html, privacy.html, refunds.html, terms.html, unsubscribe.html, test/footer-blog-link.test.mjs

**Summary:** Add SineDay Blog to existing website footer navigation

**Rationale:** Make the blog discoverable from sineday.app while preserving existing footer links and styles.

**Notes:** Added the canonical https://www.sineday.blog/ link to all 13 existing page footers. Focused footer, homepage invitation, and SineDuck tests passed (18 tests). Full suite and visual browser QA not run.

---
