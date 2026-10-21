# Website day-photo rotation

The website keeps all 180 approved photographs: ten for each SineDay. It shows
one still photograph per visit, without a slideshow or timer.

## Scope

Only the homepage day scene and its matching ambient background, and the
signed-in dashboard's **Explore today’s wave** scene, use the new collection.
The existing official SineDuck vectors, placement, rhythm calculations, account,
journal and Premium behavior remain unchanged. The old local day images remain
available as network/offline fallbacks. No email, PDF, social artwork or separate
blog article is replaced.

## What counts as a visit

- Recalculating, rerendering, changing dashboard tabs, resizing and returning from
  another tab never change a photograph already selected in the current document.
- Reloading or navigating between homepage and dashboard in the same browser tab
  reuses its selections if the previous photo activity was less than 30 minutes ago.
- A fresh tab session, or a new document after that inactivity gap, advances the
  counter only for each SineDay actually viewed. All ten appear before repeating.
- An open page never advances merely because 30 minutes elapsed. A duplicated tab
  can inherit its browser's cloned session and intentionally retain that visit.
- Local storage holds per-day integer counters; session storage holds the visit's
  integer selections and last-use time. Neither contains identity, DOB or journal
  data. Blocked, corrupt, cleared or quota-full storage never breaks the page;
  cross-visit sequencing is best effort when the browser cannot persist it.
- Two already-open tabs keep their own still photo. Simultaneous first loads can
  share an index because localStorage is not an atomic cross-tab database.

## Delivery, failure and attribution

The square scene frame uses contain-fit for the new photos, preserving the full
portrait or landscape composition without stretching or cutting it away. The
decorative ambient backdrop may cover/crop as before.

The browser loads only the selected image, with responsive widths, through the
original Unsplash image hotlink. Its ixid is preserved; the service worker does
not intercept third-party photos or precache the collection. The local collection
and selection modules are cached with the app shell. Photographer and Unsplash
links use the required referral parameters and sit on a solid, readable surface.

A failed selected photo falls back to the original local AVIF, then JPEG, then a
neutral no-photo state. A fallback does not consume the next photograph or retain
incorrect Unsplash credits. The homepage background follows the successfully
loaded card image. Slow decodes from an obsolete render cannot override it.

## Source of truth

`day-photo-selection.json` preserves the exact ordered 180-ID selection and its
SHA-256 is checked by the generator. `day-photo-provenance.json` preserves original
API-returned image and download-event URLs, dimensions, descriptions and public
photographer attribution. `npm run generate:day-photos` creates the smaller
credential-free `js/day-photo-collection.js`; `npm run check:day-photos` validates
all 180 and checks that the runtime manifest is current. Do not substitute a
similarly themed photo when changing or repairing this collection.

## Unsplash release requirement

The [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
require hotlinking, attribution and confidential API keys. A selection for use
also requires a one-time call to that photo's exact `downloadLocation`, preserving
its query parameters. See [download event guidance](https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download).

Before production release, confirm that the selected-use event for **this website
installation** has been recorded for each of the 180 IDs using the existing
secure integration, and retain a non-secret completion ledger. A prior event for
a separate blog use is not evidence for this installation. Do not send another
API event for every visitor, reload or responsive image request. No API credential
belongs in this repository, the runtime manifest or a public CI job.

## Verification

`npm test` covers selection policy, failure races, source integrity and existing
account/rhythm/email regressions. `npm run test:day-photos:browser` checks the
actual homepage/dashboard using synthetic account fixtures. Use
`PHOTO_QA_REAL_IMAGES=1` for actual Unsplash delivery; the default fixture mode
isolates behavior from external availability and is not evidence of CDN success.
The pull-request workflow uses no secrets and never deploys or mutates accounts.
Screenshots contain only synthetic profiles and public imagery.

Review the exact final commit and its browser screenshots before merging. A draft
pull request or successful test run does not authorize production publication.

### Bounded selected-use registration

`node scripts/register-day-photo-use.mjs` is a dry run by default and makes no
requests. After explicit release authorization, run its `--execute` mode using
the existing secure key, the same durable private `--ledger` on every batch,
verified `--available-requests`, and `--max-events` no greater than 35. It reserves
at least 15 of the 50 hourly requests and stops sooner when response headers
show less remaining quota. Do not assume an hour has reset without verification.
The 180 events can require multiple batches over several hours; no automatic
production release is connected to the script.

The Unsplash endpoint has no application idempotency key. The ledger therefore
records an in-flight event before sending and skips only confirmed successes.
A crash, timeout or uncertain response blocks automatic retries, rather than
risking duplicate events. Investigate any uncertain/rejected event and retain
its evidence before deciding whether a retry is appropriate. One ledger/lock
must be used for this website installation; a fresh ledger is not a retry strategy.
Never commit the ledger, the key or execution logs to this public repository.
