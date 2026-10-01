# Origin Earth and optional member lights

Implementation based on current main `678a68aaf7365d4b9a7b9200b1f076d4cafdacac`, reinspected September 30, 2026. **Not launch-ready: the migration is not applied, and the deployed member flow and physical iPhone/PWA checks remain release gates.** No production members, profiles, emails, schema, or settings were changed during development.

## Changed surfaces

| Files | Purpose |
| --- | --- |
| `js/duck-carousel.js`, `js/dashboard.js`, `dashboard.html`, `css/dashboard.css` | Replace only the ambient sphere; expose meaningful geography above unchanged duck cards; integrate actual Origin activity and account teardown. Version root JS/CSS. |
| `js/origin-globe.js`, `js/globe-renderer.js`, `js/globe-points.js` | Isolated lazy WebGL 2 scene, accessible rotation/participation controls, confirmed consent flow, bounded refresh, anonymous batched points, static/error fallback. |
| `shared/globe-regions.js`, `scripts/generate-globe-catalog.py` | Complete 249-key ISO country/territory catalog and 3,969 deterministic public land anchors. No personal coordinates. |
| `api/globe/me.js`, `api/globe/groups.js`, `api/_lib/globe-auth.js` | Verified existing bearer authentication, owner-RLS state operations, server-only database aggregate, bounded optional-feature requests. Shared auth helper is unchanged. |
| `supabase/migrations/20260930172350_globe_memberships.sql` | Separate account membership and catalog, explicit grants/RLS, server-stamped consent, deletion cascade, partial index, restricted invoker aggregate RPC. |
| `assets/globe/*`, `assets/vendor/three-r180/*`, `scripts/prepare-earth-assets.py` | Credited local NASA Earth map, static projection, official pinned Three.js modules/license, offline reproducible preparation. |
| `privacy.html`, `service-worker.js` | Narrow opt-in privacy disclosure; v34 cache update and current-version cache isolation. `/api/` remains uncached. Optional Earth assets are not installation dependencies. |
| `test/globe-*`, `package.json`, `package-lock.json`, `docs/globe/*`, change records | Focused local PostgreSQL/API/browser/PWA verification, screenshots, measurements and handoff. Test dependencies only; no app build pipeline. |

No changes to `js/sineducks.js`, official duck artwork, shared rhythm math, premium/free limits, profile records, payment, email or affiliate behavior. Existing `setProfiles`, `reload`, selection, card sizing/artwork and navigation are retained. Earth remains available with zero private profiles; the existing empty-profile prompt stays visible.

Interaction verification exposed two baseline carousel defects: scene pointer capture retargeted side-card clicks away from the card handler, and native image dragging interrupted mouse swipes. Capture now stays on the card button when appropriate, and images are non-draggable. These small interaction corrections do not change artwork or calculations.

## Honest meaning and consent

One participating light represents one explicitly opted-in signed-in **account**, free or Premium. It is not presence, online activity, private/family profiles, email subscribers, sessions or devices. No backfill or invented production lights.

“Add my light” opens an optional account-level dialog. The member explicitly chooses a country/territory from the complete catalog, with “Show my light” initially unchecked. Only a successful save changes the displayed saved state. “Manage my light” changes the chosen region or deletes the membership. Failed saves/removals leave the previously confirmed local state intact. Account deletion cascades to membership deletion.

Precision is **country/territory**, not city, GPS, inferred residency or locale. Only the coarse key and consent record are stored. Large-country subdivisions are not offered in this release. Public anchors are generated within administrative polygons intersected with physical land and excluding lakes; no runtime scattering outside that region. Map resolution and tiny islands can make an anchor subpixel. Self-selection does not verify residency or guarantee anonymity.

At low counts, one tiny point per account. Above the region's anchor budget, up to 16 points use restrained grouped density, never more points than participants. There are at most 3,969 points, one draw batch, no identities, popovers, tracking tokens or per-member DOM/mesh/light.

Aggregate response contains only `groups: [{regionKey,count}]`, snapshot `generatedAt`, `precision: "region"`, `participation: "opt-in"`. `/me` returns only own `enabled`, `regionKey`, `consentVersion`.

## Lifecycle, cache and fallback

One controller/renderer per carousel. Three.js, map, catalog and feed load on visible Origin activation. Actual pager activity, document visibility and viewport intersection gate animation/refresh; translated inert pages alone do not continue rendering. ResizeObserver handles activation/orientation. Rotation is around the tilted Earth axis, approximately 110 seconds per revolution, not canvas rotation. Reduced-motion changes stop continuous movement. Canvas is decorative and pointer-free; semantic controls have visible focus and 44px targets.

Target 30 fps, DPR capped at 1.5 with sustained-slow-frame downgrade to 1; 64×40 Earth geometry, lightweight atmospheric rim, three batched draw calls, no bloom/cloud/weather/presence work. Fixed lighting is artistic, not current sunlight.

Snapshots refresh no more frequently than five minutes while visible, reused on quick returns. No shared application/CDN aggregate cache, cron, heartbeat or Realtime subscription. Both routes are authenticated and `private, no-store`; every aggregate request performs one SQL GROUP BY. Confirmed removal updates local representation immediately. Other active viewers refresh within five minutes; hidden/inactive viewers refresh when eligible again. Reads are deduplicated and aborted on inactivity; requests have 12-second client and 5-second auth/query limits. Destroy cancels requests/timers/observers/listeners and disposes GPU resources. A pre-save response cannot resurrect an opted-out light.

No WebGL 2, context/module/texture failure uses the local static Earth, with ducks and participation still usable. No fake fallback dots. Data failure clears member dots and says “Member lights are temporarily unavailable.” Successful zero has its own message. Optional errors never redirect authentication or fail dashboard initialization.

## Migration and deployment dependencies

Live inspection of SineDay App (`dzlwxqftgzeiknfqytcj`) found no globe tables. Registered migration history contains only `20260817074152 daily_email_scheduler`; repository and live history differ. **Do not replay all historical repository migrations.** Apply this specific new migration to an isolated Supabase test project/branch first, then review and apply deliberately to production together with the API/static release.

`globe_regions`: RLS, authenticated read-only controlled catalog, no anon grants. `globe_memberships`: RLS, authenticated CRUD only on `auth.uid() = user_id`; INSERT WITH CHECK and UPDATE USING + WITH CHECK prevent reassignment; no anon/cross-account raw read. Service role has SELECT only on new tables. No existing policy is broadened. Enabled rows require the current valid consent version and server-stamped consent time. PK limits one record per account; `auth.users` FK cascades on deletion.

`globe_region_counts()`: SECURITY INVOKER, empty search_path, SQL GROUP BY over enabled/current-consent records joined to the valid catalog; execution revoked from PUBLIC/anon/authenticated and granted only to service_role. No public view or SECURITY DEFINER shortcut. One partial enabled-region index. The endpoint authenticates before invoking the admin RPC; own-state operations use the authenticated owner client, never a supplied user/profile ID or auth metadata.

Existing server environment variables are reused: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. No new secret, paid map service or application bundler. Serve both official Three.js module files with relative imports intact and correct JavaScript MIME type, plus the local JPG/WebP/catalog. v34 worker and versioned dashboard roots must ship together. Preview URL must use the test Supabase project, not production membership writes.

Pre-change live security advisors: 10 informational RLS/no-policy server tables, five existing mutable-search_path warnings, leaked-password protection disabled. Unrelated baseline findings were not changed. Remediation: [RLS/no policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Run advisors again after applying the globe migration.

## Assets and measured costs

Official Three.js **0.180.0 / r180**, MIT; local `three.module.min.js` plus its `three.core.min.js` dependency, unmodified. WebGLRenderer requires WebGL 2. NASA Blue Marble: Next Generation July 2004 complete equirectangular base map, resized to 2048×1024; texture **212,925 bytes**, fallback WebP **29,150 bytes**. [Exact source URLs, terms and modifications](../../assets/globe/SOURCES.md); [renderer version/license provenance](../../assets/vendor/three-r180/README.md).

All eight globe-specific runtime assets total **1,084,120 bytes raw**; local gzip projection **463,638 bytes (~453 KiB)**, not measured deployed transfer. Exact bytes and SHA-256s are in [asset-costs.json](asset-costs.json). No optional texture is a worker install prerequisite.

[Browser measurements](browser-results.json) record the current 390px simulated mobile viewport, backing size, frame count and CPU render-submit time. These are headless Chromium 154 with software SwiftShader, not hardware GPU frame timing or a physical iPhone/battery claim. Rendering is three draw calls / 9,984 triangles (Earth plus atmosphere) for the sample. The mobile target still needs real iPhone validation and tuning if necessary.

## Focused verification

`npm run test:globe`: local PGlite PostgreSQL role/RLS tests and API/point tests passed. Two isolated accounts cannot read/update/delete each other or reassign ownership; anon/table/RPC grants are enforced against actual local roles. Consent, malformed keys, idempotent saves, region change, opt-out and account cascade are checked. No family/subscriber table is queried. API mocks check authentication, ownership, fields and cache headers. Small empty local aggregate EXPLAIN execution ~0.18ms is not production-load latency.

35 existing focused assertions passed across `add-profile-first-ux`, `day-artwork`, `sineduck-intro`, `vercel-analytics`, `public-daily-page`, and `affiliate-support-route`. Five existing test files had only their worker-version expectations updated to v34; unrelated product logic is unchanged.

`npm run test:globe:browser`: local-only intercepted real carousel/dashboard and local HTTP service-worker tests. Synthetic profiles/counts exist **only in these fixtures**. Covers 320/390px portrait, 844px landscape, desktop, unchanged artwork/dimensions, navigation/gesture/keyboard/scroll behavior, native local module imports, pause/reduced motion, visibility and page gating, one instance, consent/failure/removal, zero profiles/counts, unavailable/offline data, WebGL/context/module/texture fallback and destroy. The real dashboard fixture covers Origin → Journal/History/Printables, account switch and sign-out. Worker test verifies v33→v34, matching JS/CSS/modules, retired-cache isolation, API bypass and successful installation despite failed optional Earth imagery. [Dashboard result](dashboard-results.json), [PWA result](pwa-results.json).

Screenshots use actual baseline/current carousel code and unchanged official assets in local test fixtures, not production members:

| View | Before | After |
| --- | --- | --- |
| 390px mobile | [before](before-mobile.png) | [after](after-mobile.png) |
| Desktop | [before](before-desktop.png) | [after](after-desktop.png) |
| Additional | — | [320px](after-small-mobile.png), [landscape](after-landscape.png), [full dashboard](dashboard-mobile.png) |

Pending release gates: Supabase-hosted test migration + A/B JWT REST checks under actual hosted grants/RLS, deployed API consent/removal/cascade and query latency under realistic volume, post-migration security advisors, deployed transfer/cache headers, physical small/typical iPhone portrait/landscape/WebKit rendering and touch, iOS installed-PWA update/offline checks. Full unrelated test suite was intentionally not run. Production migration is unapplied.

## PR-ready title and description

**Origin: add a real 3D Earth and opt-in account lights**

Replace the flat ambient sphere with a locally served, credited NASA-textured Three.js Earth while preserving duck art, rhythm calculations and carousel interactions. Add optional account-level region/consent controls, owner-only RLS membership and an authenticated coarse aggregate feed. Bound rendering/refresh costs, provide static and data-error fallback, update privacy and PWA delivery, and include focused local database/browser/PWA checks plus before/after screenshots. Keep draft until hosted migration/API and physical iPhone/PWA release gates are verified; no production migration or fake member data has been created.
