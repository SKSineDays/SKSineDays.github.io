# Violet Ash mailers — 10 November 2026

Review-only palette update for all 20 current Resend templates: Day 1–18, Welcome, and Daily SineDay Confirmation. These HTML files are not automatically deployed by the website. No provider update, publication or email send has been performed.

## Source and preservation

`source/*.json` contains read-only provider snapshots retrieved on 10 November 2026, including original template IDs, aliases, subject, sender, reply-to, variables, HTML and existing text alternatives. Use these current copies, not older editorial snapshots, as the baseline. The dated historical template directories remain unchanged.

The generator changes color values only within style/bgcolor attributes and stylesheets. Copy, HTML structure, layout, images, links, opt-out/confirmation variables, tracking exclusions, subjects, senders, aliases and plain-text versions remain unchanged. Unknown colors fail closed. `manifest.json` records SHA-256 hashes for comparison before any future provider update. Image assets retain their original artwork.

## Theme roles

- Canvas/header/footer/reflection: #24232C
- Cards/notice panels: #3B3948
- Main text and image-loading fallback text: #F6EEDF
- Secondary/footer text: #C7C2D1
- CTA fill/accent line: #EDAC9E
- CTA ink: #2E2429
- Links/eyebrows: #C8B7DC
- Rules: #9790AA

Colors are inline, with existing bgcolor fallbacks retained. No CSS variables or modern layout dependencies are introduced. Text/link colors pass 4.5:1 against both dark surfaces; CTA ink passes 4.5:1 against its fill. Existing client dark-mode protections are retained.

## Verification

Run:

    node scripts/generate-violet-ash-mailers.mjs --check
    node --test test/violet-ash-mailers.test.mjs
    node --experimental-test-module-mocks --test test/welcome-email.test.mjs test/mailer-signup-route.test.mjs test/mailer-confirm-route.test.mjs test/daily-email.test.mjs test/violet-ash-mailers.test.mjs
    node scripts/verify-violet-ash-mailers.mjs

The first three checks passed: all 20 generated copies match, palette-only structural preservation succeeds, contrast passes, and 42 focused tests pass. The browser checker is prepared for all 20 templates at 320/390/640 widths and light/dark preferences, using local assets only. Execution was blocked by this environment's Chromium socket restriction, so no visual rendering pass is claimed. Native Outlook, Apple Mail and Gmail forced-dark-mode rendering has not been tested; it requires inbox preview infrastructure or separately authorized test sends.

Existing accessibility markup is preserved, not broadly rewritten. Confirmation's existing missing title and the older templates' incomplete direction/language duplication remain known unrelated improvements for a separate pass. The unchanged plain-text receipt acknowledgments are outside this visual theme.

## Safe application later

Before applying hosted changes, fetch each existing template again and compare its HTML with `source_html_sha256`. Stop if it has changed; rebase only the colors onto the new content. Update HTML on the same template ID and explicitly pass the unchanged original text; omitting text regenerates it. Preserve all metadata. Before raw HTML updates, verify whether the template has TipTap editor content; the connector warns replacement is lossy and requires user approval for editor-authored templates. Confirmation markup appears editor-generated, but that alone does not establish its current editor state. Resolve this before application. Then publish only when authorized. Read back and compare the result. Do not create new aliases, change delivery code, change schedules, send campaigns, or alter domain/authentication settings. Retain original snapshots for rollback.
