# No-write provider diagnostic: preview handoff

## Scope

This diagnostic tests Google/Apple browser configuration and server-side ID-token verification only. It does **not** prove the Supabase signup hook, age policy, email registration, admission binding, or account-access enforcement. Synthetic tests cannot prove that either provider accepts a deployed origin.

It never creates a SineDay account, calls Supabase sign-in, creates an admission, opens billing, or sends email. A user-initiated provider login can still create a provider-side authorization/consent event. Provider token contents must not be printed, logged, copied into reports, or persisted.

## Deployment boundary

Use only the draft `feat/age-eligibility-safeguard` preview branch. Do not merge or promote to production. Do not enable either database enforcement switch or configure the global auth hook for this diagnostic. Do not copy service-role, Stripe, mailer, or production signup secrets into the preview.

Preview uses the existing project and already inherits some production-related configuration. It is not a sandbox for arbitrary payment, mail, account, or database operations.

Set the following only on this specific Preview branch after code review:

- `PROVIDER_DIAGNOSTIC_ENABLED=true`
- `PROVIDER_DIAGNOSTIC_APP_URL=https://sineday-git-feat-age-eligibility-safeguard-sineday.vercel.app`
- `PROVIDER_DIAGNOSTIC_SECRET`: a new cryptographically random secret, at least 32 characters, never reused from signup or another service
- `PROVIDER_DIAGNOSTIC_GOOGLE_CLIENT_ID`: the verified public Google client ID
- `PROVIDER_DIAGNOSTIC_APPLE_CLIENT_ID`: the verified public Apple service ID

Vercel supplies `VERCEL_ENV=preview`. Never spoof this in production. Configuration must be followed by a **Preview** rebuild, not a production deployment. Keep the diagnostic disabled until preview access protection and abuse controls are assessed. The in-process request/replay limits are not distributed guarantees.

The exact preview origin must be authorized in Google's JavaScript origins. Apple must authorize the exact diagnostic return URL ending `/provider-diagnostic.html`. Existing Supabase OAuth callback permissions do not establish those separate JavaScript permissions. Neither provider's missing permission should be asserted without inspecting its settings or observing its error. Do not change live provider settings silently.

## Owner-facing explanation

“This temporary preview checks whether Google or Apple works with our new sign-up approach. It will ask you to choose a provider and sign in there yourself. It does not create or sign into a SineDay account, change your subscription, or send an email. Only pass/fail comes back to me. This does not turn on the age gate.”

Offer the exact verified live preview URL only after deployment and disabled-path/synthetic tests pass. Do not initiate provider login on the owner's behalf. Stop before any provider action if the owner has not accepted the explanation.

## Verification and shutdown

1. Verify disabled/misconfigured/production deployments reject the diagnostic endpoint.
2. Run synthetic signature, nonce, state, expiry, origin and replay tests without provider login.
3. Verify no analytics, storage, service-worker caching, Supabase/auth client, mailer or payment integration is loaded by the diagnostic page.
4. Owner manually tests each provider. Record only provider, pass/fail and non-sensitive error category. A successful result proves token verification for that provider/origin at that time, not end-to-end registration.
5. Disable `PROVIDER_DIAGNOSTIC_ENABLED` and rebuild the preview when finished. Remove the dedicated secret and diagnostic-only values if no longer needed. No database cleanup should be necessary because the diagnostic writes none.

Current status must be reported separately from this runbook. Its presence does not mean the diagnostic has been enabled, deployed, or tested with a real identity.
