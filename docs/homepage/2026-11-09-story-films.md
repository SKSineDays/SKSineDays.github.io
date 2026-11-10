# Homepage: story and app films

Requested direction: concise, cohesive homepage cards; replace the Discover More scroll presentation with a film; keep the approved app demonstration; remove the large transcript dropdown.

## Implementation
- Two opt-in film cards. No MP4 source or download is requested until a visitor chooses a film. Playback remains user-controlled with native controls, no autoplay.
- Native modal dialog with Escape/close/backdrop dismissal, focus return, and media unloading. Direct MP4 links remain usable if JavaScript/dialog support is absent.
- Separate linked text alternatives describe text and important visual actions. WCAG 2.2 SC 1.2.1 does not require a dropdown: https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html. This addresses the silent-film alternative, not an assertion that the entire site conforms to WCAG.
- Compact hero, app and wave actions, two film cards, daily-email invitation and normal-flow date input. Existing day artwork, engine, account/profile routes and Premium product distinction are preserved.
- Original MP4, scroll animation source and art remain in the repository. Retired scroll presentation is no longer loaded or precached.
- Cache v41 updates installed app shells; video and range requests continue to bypass the worker.

## Verification
- Full local Node suite: 487 pass, 1 intentional browser-only skip (488 total).
- Day photo manifest: 18 × 10 unique attributed photos verified.
- JS syntax and git whitespace checks pass.
- Astra CSS/source pass corrected inherited artwork, CTA alignment, poster framing, focus rings and narrow-screen behavior.
- Local Chromium cannot launch: process-singleton socket blocked by execution environment. No visual/browser conformance claim is made. Added homepage-browser-smoke.cjs to PR CI for mobile/tablet/desktop overflow, opt-in media, dialog focus/dismissal and wave reset. CI and manual review remain required before merge.
- No production merge or deployment is authorized by this change record.
