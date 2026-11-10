# SineDay official theme: Violet Ash

Selected by Stephen on 10 November 2026. This is the official web-app color system. Theme changes do not change layout, copy, artwork, videos, wave placement, app flows, or the separate photo collection.

| Role | Hex | Usage |
| --- | --- | --- |
| Canvas | #24232C | Basalt-violet background |
| Card | #3B3948 | Cards, dialogs, homepage daily email panel |
| Text | #F6EEDF | Warm ivory body text |
| Muted | #C7C2D1 | Supporting text, readable at small sizes |
| Action | #EDAC9E | Peach primary actions |
| Action ink | #2E2429 | Labels on peach buttons |
| Detail | #C8B7DC | Lavender wave and focus indicators |
| Border | #9790AA | Functional control boundaries |
| Hover | #F5C0B4 | Primary-action hover |
| Paper ink | #332D3B | Text on warm ivory journal surfaces |
| Paper accent | #654A73 | Focus and links on light writing surfaces |

Shared tokens live in styles.css. Legacy --color-* names remain compatibility aliases. Standalone pages carry matching literal colors where they cannot load shared CSS. App manifest and browser chrome use the canvas color. Service worker v47 refreshes cached theme assets.

Contrast against opaque surfaces: ivory/card 9.77:1; muted/card 6.47:1; button ink/action 7.85:1; border/card 3.69:1. Alpha overlays are decorative, not substitutes for control boundaries. Focus indicators use lavender on dark UI and purple on paper UI. Errors and success states retain distinct colors and text/icons; color alone must not convey status.

Existing light journal surfaces remain light, with warm ivory paper and dark ink. The site's explicit dark appearance is consistent across OS color preferences; native controls declare dark color scheme. Printed documents retain their existing print styling and duck artwork remains untouched.

The only component treatment beyond color is the requested homepage email signup card with a filled pill action, keyboard focus and hover states. It preserves the existing signup route and content.
