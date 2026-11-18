# Account product minimum and independent mailer consent are separate

## Account declaration

SineDay's independent account product minimum is 13 across an explicit 249-entry ISO
3166-1 country/territory catalog. This is self-declaration, not verified age, parental
consent or blanket compliance with local law. Country selection is never inferred.
US retains `us-independent-13-v1`; other default account policies use
`independent-baseline-13-v1`. Existing saved decisions, review flags and profiles are
not rewritten. Matching additive database policy rows are required before activation.

`AGE_ELIGIBILITY_POLICIES_JSON` augments the baseline with explicitly versioned overrides.
An old US-only environment value does not accidentally restrict the selector to US.
Unknown country codes and malformed policies fail closed. A policy-version change
invalidates in-flight proofs and stale saved decisions; coordinate matching DB policy
changes. Omitting a country from this overrides map does NOT withdraw its baseline.
Explicit country withdrawal would need a separately designed policy, not omission.

## Daily email

Email uses `getConfiguredMailerPolicies()` and a separate DB policy/evidence boundary.
Default availability is US plus 27 EU members. It does not inherit the account minimum of 13.
Non-EU/non-US countries remain unavailable for new independent mailer activation;
the account remains available. Existing subscription delivery/unsubscribe is unchanged.

The EU thresholds are recorded with official sources in
`docs/eu-mailer-consent-policy-sources.md`. They concern the consent-age decision for the
implemented flow and do not establish complete privacy or direct-marketing compliance.
No parental-consent enrollment is implemented here.

`AGE_MAILER_POLICIES_JSON` is separate from the account policy. Overrides cannot weaken
or change the approved minimum and cannot silently add another jurisdiction. The
public selector uses `/api/eligibility-policy?purpose=mailer`; account forms use the
complete account catalog.

Authenticated activation requires a separate immutable `account_mailer_eligibility`
record evaluated from the actual owner's birthday. An account result or its coarse
`13-15` band does NOT prove a 14- or 15-year threshold. Only the separate, current-policy
eligible decision authorizes mailer activation. No DOB is persisted. Underage/rejected
mailer decisions cannot be replaced by retrying a different birthday. Support correction
requires a separate audited process. Existing account review flags remain protective.

## Ordering and limitations

1. Review the policy/source evidence and additive migrations.
2. Install account catalog and separate mailer evidence/policy migrations while readiness
   is dormant; preserve existing records and readiness switches.
3. Deploy corresponding application code; do not activate mismatched application/database
   switches. Missing or mismatched mailer readiness still fails closed.
4. Verify hosted negative paths and normal email/provider callback behavior before claiming
   completed protection. Unit/PGlite tests are not real provider/SMTP delivery evidence.

The existing email-only canary remains US-scoped. Its form/API explicitly retain that
scope so expanding the ordinary account catalog does not expand canary authorization.
No new canary, email, user account or provider call is created by these changes.
