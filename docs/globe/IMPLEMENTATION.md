# Origin Earth — PR #106 refinement

Based on current main `5fa74d1601adf6257a7a41f43cc76268ea421f60` (merged #105), inspected October 1, 2026. Live SineDay Supabase already has #105's region/membership schema, owner RLS, consent trigger, cascade and aggregate index. **The new #106 migration is not applied; production was inspected read-only.**

## Scope and files

| Files | Change |
| --- | --- |
| `css/dashboard.css`, `js/duck-carousel.js` | Earth and private profile stage share a centered grid cell; arrows belong to the scene and counter follows it. Preserve card/duck sizes, swipe, side clicks, keyboard and calculations. |
| `js/globe-renderer.js`, `scripts/prepare-earth-assets.py`, `assets/globe/earth-still.webp` | Softer brighter daylight/fill, modest specular tuning, same atmosphere/geometry/three draw calls; matching still fallback from the original NASA texture. |
| `js/origin-globe.js`, `js/globe-points.js`, `shared/globe-cities.js`, `shared/globe-regions.js` | Optional city combobox with capped results and lazy public city catalog; city light grouping and confirmed local deltas; existing country anchors continue working. |
| `api/globe/me.js`, `api/globe/groups.js` | Own city-key validation and mixed anonymous groups through a new service-role RPC; existing verified auth helper stays unchanged. |
| `supabase/migrations/20261001150055_globe_city_memberships.sql` | One forward-only migration: key/country whitelist, nullable membership city key, composite FK, consent transition, covering partial index, new invoker RPC. |
| `scripts/generate-globe-catalog.py`, `assets/globe/city-supplements.json`, `assets/globe/SOURCES.md`, `docs/globe/credits.html` | Reproducible public geography generation and exact source credits. |
| `privacy.html`, `dashboard.html`, `js/dashboard.js`, `service-worker.js` | Narrow city privacy disclosure, `earth-2` roots and `sineday-v35`; optional catalog is not required to install the PWA. |
| `test/globe-*`, five existing worker-version assertions, `docs/globe/*` | Focused database/API/points/carousel/dashboard/PWA checks and review captures. |

Official Finale assets, all duck dimensions, rhythm calculations, owner/profile limits, auth/Premium/payment/email logic and dashboard navigation are unchanged. Earth is still an isolated decorative backdrop; private profiles never enter its APIs.

## Profile geometry and lighting

The scene is content-sized. Its square Earth is still `width: min(100%, 440px)` with `aspect-ratio: 1`. Earth and viewport occupy one grid cell and align on the same vertical center; the viewport's intrinsic profile content can enlarge that cell on the smallest screens without clipping or shrinking artwork. The horizontal track retains its existing positioning/gesture logic; removing its inset padding also aligns the active card precisely with the Earth horizontally. Arrows are centered within this scene, keep 46px targets, and do not start drags. The counter is in normal flow below the composition. The old 156px/136px/355px offsets are removed.

Same Three.js r180 / MeshPhongMaterial: shininess 9, subdued blue-gray specular, cool ambient intensity 1.3, subtle hemisphere fill .45 and warm directional sunlight intensity 3.1 from `(-3, 2.4, 3)`. The shadow side stays dark; no exposure pipeline, bloom or new library. Atmosphere/member-light shader, sphere geometry, 30fps/DPR budget, rotation, reduced motion, context fallback and teardown remain. Still fallback uses the same map, brighter fill/day direction and no invented dots.

## Cities, consent and privacy

One enabled account remains one participant. A member explicitly chooses a country and optional city. No GPS, browser geolocation, IP lookup, location inference, or third-party runtime geocoding. Family profiles and mail-only subscribers are excluded. Location choices are approximate representation, not verified residency or guaranteed anonymity.

7,332 owned static choices: 7,330 Natural Earth v5.1.2 populated places with supported ISO countries and two U.S. Census Gazetteer supplements (Springdale, Arkansas; Paris, Texas). Fayetteville, Arkansas and Paris, France are in Natural Earth. Stable keys use `NE_ID` or Census GEOID. Labels, admin names and public city anchor coordinates live in code; the database whitelist stores only key/country pairs. [Sources and maintenance command](../../assets/globe/SOURCES.md).

The catalog is approximately 931 kB raw / 184 kB projected gzip (local measurement, not deployed transfer), downloaded only when the dialog opens or a city group needs rendering. The native country select is retained. The accessible city combobox filters only the chosen country, mounts at most 20 result buttons, supports arrows/Enter/Escape/Tab, disambiguates admin names and uses 44px targets and 16px input text. Country changes clear incompatible cities. No selection happens automatically. Unmatched text cannot save as a fabricated city. Empty/unlisted locations can use country-only precision. Catalog failure leaves profiles, the Earth and country lights usable; the saved city key is preserved until explicitly changed or removed.

Opening legacy “Manage my light” restores the country. Explicit catalog retry uses a fresh module URL after a transient loading failure. Existing consent `2026-09-30` remains valid **only without a city**. City saves require `2026-10-01`; changing location clears the checked consent in the dialog and requires the member to check “Show my light” again. New consent wording explicitly discloses city aggregation. No historical row is backfilled or disabled. The trigger stamps city changes and clears all location/consent fields on disable.

Database RLS/ownership policies and `auth.users` deletion cascade remain intact. Composite `(city_key,region_key)` FK prevents bypassing API validation with invented or incompatible city keys. Catalog grants are authenticated read-only; no anon access. Both aggregate RPCs are SECURITY INVOKER with empty search_path, 3s statement timeout and service-role-only execution. The new partial `(region_key,city_key)` index covers enabled, consented rows; grouping uses no catalog join or raw member export. Exact aggregation still necessarily reads participating index entries; this is not a constant-cost counter system.

`/api/globe/me` returns only own `{enabled,regionKey,cityKey,consentVersion}`. PUT accepts only those location/consent inputs and derives `user_id` from verified auth. DELETE removes the membership. `/api/globe/groups` authenticates then calls `globe_location_counts()` and whitelists `{precision,regionKey,cityKey,count}` per group, plus snapshot metadata. Both remain `private, no-store` with `Vary: Authorization` and bounded queries. No names, email, account/profile IDs, personal coordinates, per-member timestamps or presence.

Each city group renders one restrained point at its public anchor, with capped density/size; repeated groups cannot create duplicated points. Country-only groups retain up to 16 deterministic land anchors. No counts/popovers/leaderboards are presented. Confirmed moves/removals apply a delta to the matching city or region in the local snapshot. Five-minute visible refresh, error handling, activity gating and teardown stay intact.

## Release steps — Stephen

1. Review the PR and perform final visual QA on physical iPhone portrait/landscape, small-screen city search with the keyboard open and desktop. Local captures are review aids, not physical-device certification.
2. Apply **only** `supabase/migrations/20261001150055_globe_city_memberships.sql` to the SineDay App project (`dzlwxqftgzeiknfqytcj`) through the SQL editor or a targeted migration operation. It is transactional. **Do not run/replay `20260930172350_globe_memberships.sql` or push all historical repo migrations.** No production test accounts or QA writes are needed/authorized here.
3. Read-only verification after application: confirm `city_key` exists, `globe_cities` has 7,332 key/country pairs, both RPCs are service-role-only and the covering index exists. Run post-migration security advisors and compare against the existing baseline. Use an isolated test project for hosted A/B JWT consent/save/remove/cascade validation if hosted verification is needed.
4. Merge the PR when ready; allow the existing production pipeline to deploy API, city catalog, dashboard roots, fallback and worker together. Migration must precede the new API. Old `globe_region_counts()` remains available for #105 clients during rollout and returns country-level totals under both valid consents. No new secrets or map-service setup.
5. Reload/reopen the installed PWA, verify `sineday-v35` activation and current `earth-2` assets, unchanged private profile navigation and country-only saved state. Inspect live `/api/globe/*` authentication/no-store behavior read-only; opt in to a city only as your deliberate real member action. Final visual acceptance belongs to Stephen.

## Focused verification

`npm run test:globe`: existing local PGlite PostgreSQL roles/RLS plus new forward-migration/API/points cases. Covers old-row preservation, save/change/delete, both consent versions, bad city/country/extra-coordinate rejection, owner isolation/reassignment, cascade, catalog grants, service-only RPCs, mixed aggregation, approved response fields and one batched bounded city light. A local 10,000-disabled-account scale check selects the participation index; it does not certify hosted latency at production scale.

`npm run test:globe:browser`: local synthetic fixtures only, all production requests intercepted. Tests geometry and unchanged duck dimensions at 320/390/844/1280, swipe/side click/arrows/keyboard, lazy catalog, search/restoration/fresh consent/change/country-only/empty/failure, lifecycle/fallback and real dashboard teardown. Worker smoke checks v34→v35, current module/CSS delivery, retired-cache isolation, API bypass and installation independent of optional globe data. All 6 globe tests, 25 focused existing regression tests and all three browser smoke scripts passed. Actual results are recorded in adjacent JSON files. Headless Chromium/SwiftShader measurements are not physical iPhone GPU timing.
