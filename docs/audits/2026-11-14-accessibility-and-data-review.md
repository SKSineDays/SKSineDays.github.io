# SineDay accessibility and data-flow review

Reviewed 2026-11-14 UTC against main commit c53db73c6c58fa5a33e7822c3de4274c8f3ae99c. This is a bounded code review, not a legal opinion or a certification of ADA, TCPA, COPPA, or WCAG compliance. No production settings or customer records were changed.

## Priorities and disposition

### 1. Decide account audience and under-13 handling before launch

Current implementation:
- `login.html` and `js/supabase-client.js` offer Google, Apple, and email sign-in. Email authentication allows account creation (`shouldCreateUser: true`), with no age eligibility step before the authentication request.
- `daily.html`, `js/daily-signup.js`, `api/mailer-signup.js`, and `api/_lib/email-rhythm.js` collect a birthdate to derive the daily rhythm. Validation checks valid dates and rejects future dates, but does not reject an under-13 date. The public mailer does not persist the full DOB; it stores email, derived rhythm, preferences and consent following confirmation. Removing the DOB does not by itself answer the children's-data question.
- `js/dashboard.js` stores profile names, DOBs and time zones in account-linked profiles, including family profiles. Adult-provided family information must not be assumed to have been supplied directly by a child.
- `terms.html` does not state a minimum account age. No verifiable-parental-consent workflow was found in this repository.
- Family profile deletion exists in `handleDeleteProfile`, with account-ownership filtering and an owner-profile guard. No self-service full account deletion endpoint was found. `privacy.html` directs data requests to support. This review did not inspect live customer records, actual support procedures, or vendor retention settings.

Decision needed: define whether accounts and public email subscriptions are intended for adults, people 13+, or children with a parental flow, and distinguish adult-managed family profiles. Review that choice with qualified counsel, including the actual marketing audience. Then implement consistent UI/server enforcement, accurate notices, and a verified support/deletion procedure. Do not mistake a checkbox, double opt-in email, or a general age gate for verifiable parental consent. Do not add a broad DOB cutoff to the shared rhythm calculator: that would also break adult-managed family profiles and does not address OAuth creation.

FTC guidance distinguishes services directed to children from general-audience services with actual knowledge; it does not require every general-audience site to ask users' ages. Information supplied by parents/adults is also treated differently from collection directly from children. See the [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), especially A.8, A.12 and H. The FAQ points to the [current rule](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312); do not rely on older summaries alone.

### 2. Repair the homepage About dialog's accessibility isolation

The About dialog marks itself modal but originally made only the header and main content inert. Footer content remained accessible outside the dialog. Repeated calls to open the dialog could add multiple key handlers and overwrite the original focus-return target. The accompanying fix isolates all background body siblings, preserves their existing inert state, makes repeated open/close calls harmless, and includes regression coverage for state isolation and repeated opening. A browser test for keyboard wrapping, dismissal and focus restoration was added but could not run in this executor because Chromium launch was denied by its socket restrictions.

Keep testing other dialogs and authenticated flows independently. This targeted change is not a full screen-reader, contrast, zoom, mobile or WCAG conformance audit. The existing public login and daily signup forms have explicit labels and status/error announcements; this review did not find a reason to rewrite those fields.

Use WCAG as an engineering benchmark without representing SineDay as certified compliant. [DOJ web accessibility guidance](https://www.ada.gov/resources/web-guidance/) discusses businesses open to the public; the specific Title II technical rule for state/local governments should not be represented as automatically governing this private service.

### 3. Keep SMS disabled unless a separately reviewed feature is introduced

Repository search found no SMS send path, phone-number entry form, or Twilio/Telnyx dependency. The public mailer migration `20260915150000_public_daily_email_signup.sql` initializes `sms_enabled` and `sms_opt_in` to false; email subscription does not opt people into SMS. `signInWithOtp` here receives email, not a phone number.

No SMS implementation or consent wording was added. Dormant database columns are not evidence that texts are being sent. This code review cannot establish whether a separate external service sends texts. Before introducing SMS, inventory sender/service, purpose and recipient jurisdictions, review applicable consent/opt-out requirements, and implement evidence retention and suppression appropriate to that service. Email consent must not be repurposed as SMS consent.

## Boundaries

- No customer signup, marketing message, live database write, permission change, or deployment performed.
- No deletion, retention-policy, terms, age-policy, or parental-consent commitments invented.
- The downloaded production `daily.html` and `privacy.html` exactly matched the reviewed source on this date. No real signup was submitted.
- Main app repository only; the separate blog and third-party systems require their own review.
- Existing unrelated tests and final focused browser results are reported in the pull request; passing code tests is not a legal compliance finding.
