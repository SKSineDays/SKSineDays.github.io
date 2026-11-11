# Affiliate share kit

The authenticated Affiliate dashboard offers three customer-facing layouts and
the Affiliate wordmark. Keep the kit small: one square, one story and one wide
format. The layouts introduce the journal rather than recruit new affiliates.

## Use

- Square post, 1080 × 1080: pair with the dashboard's full post, which includes
  the affiliate link and disclosure.
- Story, 1080 × 1920: add the affiliate URL through the platform's link sticker.
  Space beneath “Explore SineDay” is intentionally left clear for that sticker.
  Essential artwork starts below the top interface area, and the disclosure is
  above the bottom interface area. Check the final post before publishing.
- Landscape post, 1200 × 628: use beside a complete caption or in an email that
  clearly includes the affiliate link and disclosure.
- Affiliate wordmark, 700 × 240: the SVG embeds its image and works offline.
  Preserve its proportions and include disclosure in the surrounding content.

The graphics include “Affiliate link: I may earn a commission.” Do not obscure
it. The accompanying post still needs a clear, conspicuous disclosure. A generic
graphic does not embed anyone's personal affiliate link or code.

The artwork uses the canonical SineDay wordmark and the complete, untouched
SineDuck8 SVG at its original 2:1 ratio. The ivory journal card is an illustrative
composition, not a screenshot. Colors follow the Violet Ash theme. Product copy
describes reflection and journaling without health, prediction or income claims.

## Regenerate and verify

Run `node scripts/generate-affiliate-assets.mjs` from the repository root. This
uses the existing `sharp` development dependency and only local brand sources.
It writes the three PNGs, standalone wordmark and `assets.json`. No account data
or external services are involved.

Run `node scripts/generate-affiliate-assets.mjs --check` to validate the committed
manifest, image dimensions and self-contained wordmark without rewriting them.
Review all PNGs visually after any copy or layout change, including the story's
link-sticker space and disclosure. Font rasterization can vary across renderers;
the script uses Arial with Helvetica and sans-serif fallbacks.

Program claims and disclosures must continue to follow `/affiliate-terms.html`.
Do not add pricing promises to these evergreen graphics. Use the dashboard's
current approved copy for promotion details.

## Dashboard checks

Run `npm test`, `npm run check:affiliate-assets`, and
`npm run test:affiliate-dashboard:browser` before release. The browser check
requires Playwright Chromium and writes screenshots and results to
`artifacts/affiliate-dashboard/`. Its fixture uses sample account data and
intercepts all network activity. It never calls a production API, signs in,
opens a real Stripe session, or publishes a post.

The review covers narrow and desktop layouts, image decoding and download,
complete disclosure copy, cancelled sharing, blocked clipboard recovery,
partial loading failures, keyboard navigation, repeated actions, and closing
or destroying the panel during pending work. The existing application gate,
account status rules, attribution, financial calculations, and payout routes
are unchanged.
