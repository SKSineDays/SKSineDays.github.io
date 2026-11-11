# Offline elemental-mailer fixtures

These 18 proposed HTML/plain-text templates are review fixtures, not live provider templates. They contain no subscriber addresses, provider IDs, credentials, or resolved unsubscribe URLs. The existing `{{{OPT_OUT_URL}}}` variable remains unresolved.

`contracts.json` retains the original hero tag and template variables. The verifier reverses exactly the proposed hero src/alt replacement and credit insertion, then compares SHA256 against the recorded original-provider HTML in the asset manifest. All other original HTML bytes, including copy, Violet Ash styles, blog links, wave images, and template variables must be preserved. Plain text is checked against its unchanged SHA256.

Run `node scripts/verify-elemental-mailers.mjs --validate` for static checks, or omit `--validate` for offline Chromium rendering at 320/375/520/1280px in light/dark preferences plus image-blocked checks. Every browser request is fulfilled from checked-in bytes or aborted. No template publication or email sending is performed. This is browser rendering evidence, not native Gmail/Apple Mail/Outlook certification.
