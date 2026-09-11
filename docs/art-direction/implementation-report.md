# SineDay artwork implementation and focused verification

Base: `main` at `630d14b34ede56c01b8d7a412245c59b72e6df66`, rechecked against origin before delivery. Work is on `codex/sineday-18-day-artwork`.

## Source and integration

- `js/sineday-engine.js`: `DAY_DETAILS` is the exact 18-paragraph source; `DAY_DATA` supplies numbers, phases and supporting lines. All prose, bullets and wave calculations are unchanged. Image metadata now supplies versioned JPEG/AVIF URLs and concise scene alternatives.
- `index.html`, `js/ui.js`, `styles.css`: public result image and connected paragraph, plus the ambient photographic backdrop. Current artwork receives priority, decodes before its reveal, and shares its selected format with the backdrop.
- `dashboard.html`, `js/dashboard.js`, `css/dashboard.css`: Today’s Wave → Explore this wave → image and paragraph. The square is reserved before loading; artwork loads lazily, with a square desktop composition and a vertical mobile layout. The reflection scroll margin keeps it below the sticky navigation.
- `js/sineducks.js`: matching official `assets/sineducks/SineDuck1.svg` through `SineDuck18.svg` are layered in both image cards. Original SVG and PNG assets are unchanged. The SVG preserves its full 2:1 shape and original colors; the foreground panel moves between two positions to protect each scene’s principal detail.
- `service-worker.js`: cache `sineday-v21`, fresh core-asset installation, old-cache retirement, and artwork runtime caching with an HTTP-cache reload on the first miss. API responses remain uncached. A full storage cache cannot hide an otherwise available network image.
- `site.webmanifest`: retains the Day 9 JPEG screenshot reference, with artwork version and correct square dimensions.
- `package.json`, `scripts/preview.mjs`: a dependency-free native Node static preview command, added for the required responsive checks; no production build step, framework or bundler.

Replaced `Day1.jpeg` through `Day18.jpeg`; added `Day1.avif` through `Day18.avif`. All are 1254 × 1254, exported from the generated originals without upscaling. JPEGs remain fallback assets and preserve established filenames. The AVIF set totals 3,922,853 bytes versus 6,908,264 bytes for the previous JPEG set (43.2% smaller). Only the requested day is downloaded; the worker no longer precaches all eighteen landscapes. No adjacent prefetch was added because the current reflection surfaces do not offer a sequential day carousel.

## Art direction and review

A single temperate limestone woodland and lake, seen at different distances: first step, wind-bent meadow, unfolding fern, confluence, continuous cascade, balanced cove, visible strata, resilient tree, river bend, growth rings, forest floor, correcting rill, released leaf, clear spring, nourishing moss, waiting buds, roots and returning shore wash. Slate blue, restrained warmth and natural greens connect the cycle without assigning value to wave height. Day 18’s shore returns to Day 1’s first step.

`day-backgrounds.md` records all exact paragraphs and the complete creative matrix. `day-background-prompts.json` records the shared language and individual prompts, finalized before generation. `day-background-assets.json` records byte sizes and hashes. `day-backgrounds-contact.jpg` shows all environments; `collection.html` renders all eighteen official-duck pairings using the actual shared styling and mapping. All environments and final foreground compositions were visually reviewed together. Upper placement was introduced where lower placement covered the paragraph’s visual anchor.

## Focused checks performed

- `node --test test/day-artwork.test.mjs`: three passing tests. All eighteen computed days retain their exact paragraph, bullets, phase and supporting line; JPEG/AVIF hashes and official SVG mapping match; Day 19 cycles to Day 1. Worker lifecycle simulation retires v20, refreshes both versioned and legacy artwork URLs, retains viewed artwork offline, avoids all-eighteen installation downloads, handles full storage and never caches APIs. Reduced-motion runtime check confirms immediate backdrop replacement and nonanimated scrolling.
- All 36 production image files decode successfully at 1254 × 1254.
- Live browser: public result renderer and dashboard reflection renderer exercised through Days 1–18. Each selected image, matching SineDuck and exact paragraph passed; all images selected AVIF.
- Live browser: 320 × 568, 375 × 812, 390 × 844 and 430 × 932 frames passed square composition and duck containment checks in both surfaces; mobile screens visually reviewed. Dashboard also passed 768px and 1280px layouts.
- Both browser surfaces recovered an intentionally missing AVIF through their matching JPEG fallback and settled correctly on Day 17 after rapid Day 3 → Day 17 selection. Reserved square dimensions remained stable across the cycle.
- No asset-change application console errors observed in normal rendering. Deliberately induced missing-asset errors were confined to the fallback check. A temporary fixture race was corrected before dashboard verification; browser extension metadata errors were unrelated.
- Changed JavaScript syntax and `git diff --check` passed. The full application suite was not run.

## Scope and remaining production limits

Browser viewport tests used real public HTML and modules, and a dashboard fixture built from the exact production renderer functions and dashboard HTML/CSS with a synthetic owner. Authenticated dashboard initialization was not exercised; authentication, subscriptions, Supabase, Stripe, affiliates and Daily Duck delivery were not modified. Physical iOS/Safari and an installed HTTPS PWA were not available in the preview environment. Service-worker behavior was verified with the actual worker in a lifecycle simulation; browser-installed PWA behavior is not claimed.

Offline artwork is available for previously viewed days. A never-viewed day needs a network connection for its landscape and duck; its written reflection remains available where the app’s existing offline shell supports it. Existing installed clients receive the new cache after the normal worker update lifecycle. This is a reviewable branch change, not a production deployment.
