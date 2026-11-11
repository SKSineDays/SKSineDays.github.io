# SineDay PTA and community group share kit

## Direction

**Community concept: A little reflection. A shared purpose.**

An adult-facing invitation to a daily journal, expressed in a group's voice.
The kit uses SineDay's Violet Ash, ivory, apricot and lavender palette. Layered
journal cards make the community variant visibly distinct from the personal
kit without creating a new brand or changing the canonical wordmark/SineDuck.

**PTA concept: Information, with room to decide.**

PTA materials are factual notices, not recommendations to buy. The separate
PTA mode contains three neutral text formats and one restrained wide graphic.
The unit must review whether this specific arrangement is appropriate under
its state PTA, school and local rules. Neutral wording is not a compliance
certification and may still be unsuitable for a particular unit.

## Where it lives

Existing Affiliate dashboard → Share kit → Share kit folders.

- Personal: existing personal copy and four existing assets, unchanged.
- Community groups: six copy formats, four images and a fillable flyer PDF.
- PTA / PTSA: three factual notices and one information graphic.

PTA has its own folder, with an immediate plain-language note about informational
wording, local review and varying policies. Its published artwork and READ-FIRST
guide live under `assets/affiliate/groups/pta/`.

This is a content selector, not a new dashboard, enrollment path, account type,
payment feature or permission system. The authenticated account, referral URL,
code, approval process, Stripe setup and program terms remain unchanged.

Before preparing group copy, a leader enters the authorized group name and
confirms authority, group ownership of this account's commissions and the
necessary organizational approvals. PTA mode requires fresh confirmation when
switching from community mode. This is a local preparation check only; it does
not independently verify legal ownership or institutional approval. An
individual account must not represent its earnings as belonging to a group.
The name and attestation remain in memory only for the open interface; no
storage or API writes are added. Inactive status clears the name and approval.

## Contents and use

Community text: social post, community email, newsletter blurb, group message,
story caption and flyer companion text. PTA text: newsletter notice, website
information and meeting announcement. Each copy has the group's name, the
existing referral link, an adjacent commission disclosure and optional
participation language. Most formats also include the existing account code.
The dashboard can copy a selected format or download all that mode's copy.

Images:

- Square community post: 1080 × 1080 PNG.
- Community story: 1080 × 1920 PNG. Add the actual approved referral link as a
  link sticker in the open space; do not cover the disclosure.
- Newsletter image: 1200 × 628 PNG. Include the link and disclosure in live
  email text as well, so they remain useful with images disabled.
- Community flyer: 1275 × 1650 PNG, US Letter proportions.
- PTA information notice: 1200 × 628 PNG, for approved factual information.
- Fillable community flyer: US Letter PDF. Fill **Group name** and **Group
  affiliate link**, save, inspect text fit, and test the full tracked link
  before printing. No fake or generic QR code is supplied.

Generic images cannot encode an account's personal link. Pair them with the
matching complete text. Do not detach, obscure or remove disclosures. Preserve
brand proportions. This kit uses no National PTA marks, school seals, mascots,
children's photographs or claims of official partnership.

## Claims checked against the existing program

Repository baseline: `99ba1ad` (PR #136), checked 2026-11-11.

Source of truth: [Affiliate Program Terms](https://www.sineday.app/affiliate-terms.html),
also `affiliate-terms.html`; account/country checks in `api/_lib/affiliate.js`.

- An authenticated approved active account and completed Stripe setup are
  required by the existing flow. The kit does not expand eligibility.
- Existing terms specify $1 per eligible successful monthly Premium invoice,
  with exclusions, refunds/credits/disputes and self-referrals handled by the
  current program. No commission is claimed for clicks or free signup.
- The 30-day hold and ordinary monthly review remain subject to the current
  conditions. No amount or payout date is guaranteed.
- The current customer discount is conditional; evergreen group artwork and
  copy avoid promising a price or making a new offer.
- No automatic group treasury routing, donation, tax deduction, fundraising
  total, use of proceeds, student benefit, health effect or private-journal
  access claim has been introduced.

No payment code, school/group onboarding, application flow, terms or database
schema is changed. Creating these materials does not authorize outreach.

## Research and branding sources

Reviewed 2026-11-11. Recommendations below are design choices informed by the
sources, not legal advice or PTA approval.

1. [National PTA fundraising: Donations](https://www.pta.org/local-leader-kit/fundraising/strategies/donations)
   distinguishes sponsor acknowledgment from endorsement. Applied as a
   separate factual PTA track rather than relabeling sales-oriented copy.
2. [National PTA Branding and Web Guidelines](https://www.pta.org/home/run-your-pta/PTA-Branding-and-Web-Guidelines)
   establishes controlled use of PTA names and marks. Applied by using
   SineDay-only artwork and no implied National PTA relationship.
3. [California State PTA: Sponsorship versus Endorsement](https://capta.org/toolkit/home/finance/fundraising/sponsorship-versus-endorsement/)
   discusses structures, royalties, e-commerce links and nonendorsement.
   Applied as an explicit unit/state/school review requirement, not blanket
   permission for the affiliate model.
4. [FTC Endorsement Guides: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
   addresses material connections and affiliate disclosures. Applied as
   readable disclosure beside each link and visible in every image, never
   hidden in the instructions alone.

## Rebuild and verification

- `npm test`
- `npm run check:affiliate-assets`
- `npm run generate:group-affiliate-assets` to regenerate the new kit.
- `npm run check:group-affiliate-assets` to check committed output.
- `npm run test:affiliate-dashboard:browser` for offline browser fixtures at
  320, 390, 768 and 1440 pixels, including the new modes and prior regressions.

Generator uses only canonical local artwork and existing `sharp`/`pdf-lib`
dependencies. No remote images, real accounts, API calls or posts are needed.
Browser fixture blocks all network and checks mode switching, separate PTA
assets, approval revocation, copy/link/disclosure integrity, image-failure
recovery and unchanged personal controls. Existing payout/close/focus tests
remain in the same suite.
