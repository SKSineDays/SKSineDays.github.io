# SineDay website-card mailer review · 2026-10-05

This additive snapshot contains the corrected daily mailers and an offline browser verifier. Generating these files does not update live Resend templates or send email. Website card source and all previous dated snapshots, generators and tests remain intact.

## Content contract

For each of the 18 existing days:

1. Preserve the exact existing title, phase, subject, alias and template ID.
2. Use the website's exact `DAY_DATA.description` as the subtitle.
3. Replace both invented body paragraphs with the single complete `DAY_DETAILS[day].paragraph`.
4. Replace the Notice text with all four exact `DAY_DETAILS[day].bullets`, in order.
5. Ask one day-specific reader question under the existing “Your Sine, through your eyes” heading.
6. Retain the exact reply invitation. Remove the entire fictional-writing caveat element, with no replacement.

The question is the only newly written reader-facing passage. The hidden HTML preheader is mechanically assembled from the day, existing title and exact website subtitle. Website text is copied verbatim, including its existing “Journal for 5 minutes” and “write it down” guidance. No fictional or real writing assignment is added in the reflection section.

## Source and provenance

`copy.json` contains exactly 18 entries with `day`, `title`, `phase`, `subtitle`, `paragraph`, four `bullets`, and `question`, under schema version 1. The generator imports `DAY_DATA` and `DAY_DETAILS` directly from `js/sineday-engine.js` and rejects any source mismatch rather than silently replacing draft text. Website titles/phases are cross-checked against canonical email identity.

`source-provenance.json` maps every subtitle, paragraph and bullet to its source selector and line number. New questions are explicitly attributed to `copy.json`. `template-manifest.json` records SHA-256 hashes for the generated HTML/TXT, exact website source and immutable `20261005` baseline. Existing template IDs are cross-checked against the archived `20260924` identities.

Read-only audits on 2026-10-05 verified all 18 baseline HTML/TXT pairs against live Resend and all 18 source cards against the live website. This generator never contacts either service.

## Preserved email shell

Every byte outside these explicitly permitted surfaces is regression-tested against `20261005`:

- Hidden preheader text, subtitle text and first paragraph text
- Removal of the second body paragraph element
- Replacement of the Notice paragraph with one semantic four-item list, using the existing Notice typography/color and inline email-compatible styles. Each list item explicitly duplicates the list’s font-family, font-size, line-height and color for the current template-service contract; this adds no wording or visual change
- Reflection question text and removal of the caveat element

All other tags, attributes, images, image alt text, links, CTA, blog block, footer, reply destination, privacy text, tracking attributes, canvas color locks and unsubscribe template variables stay unchanged. HTML and plain text contain the same complete visible copy. No style blocks, active content, new template variables, external calls or third-party tracking are introduced.

## Generate and check

From the repository root:

```sh
npm run generate:card-aligned-mailers
npm run check:card-aligned-mailers
npm run check:daily-editorial-copy
npm run check:daily-email-copy
npm test
```

Generation is deterministic and additive. Check mode never repairs stale files. Missing, duplicated, extra or mismatched identities, missing/duplicated content surfaces, source drift, assignment-like or non-question reflections, and stale provenance/output are hard failures.

No dependency versions or lockfile changes are required.

## Preview

The hosted review viewer has been removed. The offline browser verifier builds the side-by-side viewer entirely in memory for its 18-day and width-control tests; the generator does not write a viewer into the static site. Production email HTML and image URLs remain unchanged.

## Verification

- 25 new regression tests pass, covering all 18 days, exact source locking, complete HTML/TXT parity, every protected shell byte, immutable identities, source provenance, malformed copy, absent/duplicate surfaces, literal replacement tokens, and stale/extra outputs.
- Full repository suite: 300 tests pass, 0 failed, 0 skipped.
- Both historical snapshot generators and the new generator pass deterministic check mode.
- The offline Chromium verifier is provided at `scripts/verify-card-aligned-mailers.mjs`, covering 108 day/width/color renders, 18 image-blocked cases and 54 preview-control interactions. It could not execute in this environment because Chromium cannot open its required process socket. These checks are unrun, not passed.
- Native Gmail, Apple Mail and Outlook certification is not available and was not run.

## Publication boundary

Publishing this repository snapshot does not update stored Resend templates. Live-template publication requires authorization, hosted browser verification, a fresh live drift check, rollback capture, unchanged aliases and metadata, and exact returned HTML/TXT verification. Subscriber and test email sends are separate actions.
