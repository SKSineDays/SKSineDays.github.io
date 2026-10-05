# Daily SineDay editorial review — 2026-10-05

Local review draft for all 18 existing daily aliases. This work does not publish templates, send email, change Resend, or alter the app's daily calculations. Welcome and Confirmation are outside the scope.

## Editorial shape

Each email develops one point through an ordinary situation, carries that point into “Notice today,” and offers a specific, open-ended writing invitation. The wave supplies the names and order, rather than predicting the reader's mood, energy, health, or experience.

The mySine section is 39–43 words including its heading and reply invitation. The short prompts leave room for a lived or fictional response. Each entry's `core_point` and `diagnosis`, together with the collection notes, are editorial review metadata and do not appear in the email.

## Exact scope and preserved content

The generator reads the immutable `20261004` HTML/text snapshot and changes only these text interiors:

- Hidden HTML preheader (plain text has no hidden preheader)
- Subtitle and two main body paragraphs
- “Notice today” question
- mySine writing prompt and shared caveat

For the current Resend update contract, which excludes `<style>` elements, the generator also moves the exact existing `:root{color-scheme:light only;}` declaration from its sole style block to `<html lang="en" dir="ltr" style="color-scheme:light only;">`. This is the only shell adjustment; it fails closed if the expected root/style block is missing, duplicated, or accompanied by an unexpected style element. The existing body and meta canvas locks remain byte-identical.

Canonical titles, phase labels, subjects, aliases, archived template IDs, day order, scene and wave image tags, all other attributes/styles, dashboard CTA, blog block, reply destination, footer, privacy promise, unsubscribe URL variable, and tracking attributes remain unchanged. Every other HTML and plain-text byte is protected by regression tests. The compatibility move changes no reader copy or plain-text file. The prior `20260924` and `20261004` snapshots and original generator/tests remain intact.

`template-manifest.json` records canonical alias/subject, archived template identity, generated HTML/text SHA-256 hashes, and corresponding `20261004` baseline hashes. The template IDs come from the `20260924` archive, not a new live-service audit.

## One source for both formats

Edit this directory's `copy.json`, then run from the repository root:

```sh
npm run generate:daily-editorial-copy
npm run check:daily-editorial-copy
npm run check:daily-email-copy
npm test
```

The source contains exactly 18 `days` entries, with `day`, `title`, `phase`, `core_point`, `diagnosis`, `subtitle`, `preheader`, exactly two `paragraphs`, `notice`, and `writing_prompt`. Shared reflection fields are top-level, matching the previous snapshot's format. Only `reflection_caveat` can change; the label and reply fields are protected. Optional collection/editorial/preservation notes are review-only metadata.

The additive generator is `scripts/generate-daily-editorial-copy.mjs`. It verifies baseline hashes and fails on missing/duplicated targets, invalid day identity/schema, introduced variables, or changed protected destinations. Replacement strings remain literal, HTML text is escaped, and check mode verifies without repairing stale files. No dependencies were added.

## Local preview and verification

Start the existing static-only server with `npm run dev`, then open `/docs/email-templates/20261005/preview.html` at its local address. The preview can switch among all 18 days at 320, 375, and 520 pixels. It is not a publication or subscriber-send tool.

The existing browser verifier accepts an optional dated snapshot while preserving its `20261004` default:

```sh
npm run test:daily-editorial-copy:browser
# Equivalent:
node scripts/verify-daily-email-copy.mjs --directory 20261005 --output /tmp/sineday-daily-editorial-preview
```

With a usable local Chromium installation, it covers 108 renders (18 days × three widths × two color preferences) and 18 image-blocked checks. Every request is intercepted and official checked-in image bytes are served locally. Browser execution depends on the environment; static regression tests are not browser or inbox-client certification.

The new tests cover complete visible HTML/plain-text parity, unchanged protected bytes/tags/styles/images/links/variables, brief reflection length, all 18 canonical identities, manifest hashes, schema failures, duplicate/missing sections, markup escaping, literal dollar tokens, and stale-output detection. The original snapshot's deterministic check and existing tests still apply separately.

### Verification for this draft

- Both snapshot generation checks pass; the complete test suite passes 275/275, including all 24 new editorial tests and the root-style compatibility guard.
- The full suite was run in an isolated temporary copy with the unchanged tracked dependency tree plus the previously verified dependency set. No tracked dependency or lockfile changes were made.
- WeasyPrint 70 static rendering passes all 54 day/width combinations (18 days at 320, 375, and 520 pixels), with every new copy section and preserved footer visible and no text overflow. After the root-style compatibility adjustment, all 54 renders pass again and all 18 newly rendered mobile PNGs are pixel-and-byte identical to the pre-change previews.
- Chromium/browser rendering and native Gmail/Apple Mail/Outlook inbox verification remain unrun for this draft. Static rendering does not certify those clients or their dark-mode/image-blocking behavior.

## Publication gate

This directory is review material. Publishing to live Resend aliases, changing repository state remotely, hosting previews, and sending subscriber or test emails require separate authorization. A repository merge alone does not update stored Resend templates. Any authorized publication must first retain a fresh rollback copy, check live drift, preserve all non-content metadata and existing aliases, and verify both returned formats against this manifest with the service's known newline normalization.
