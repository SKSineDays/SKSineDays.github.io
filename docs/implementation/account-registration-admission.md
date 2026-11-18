# Independent-account admission: staged implementation, not a live compliance claim

This change is **not ready for production activation solely because local tests pass**.
No existing accounts are migrated, suspended or deleted. US independent accounts use the
owner-approved 13+ policy. Other jurisdictions require explicit reviewed configuration;
this branch must not silently turn US13 into a worldwide policy. A declaration is not
verified age or verified parental consent.

## Application flow

- Existing Sign in buttons retain Google/Apple OAuth. Email Sign in sets
  `shouldCreateUser: false`. A new provider identity must be rejected by the DB admission
  controls unless it came through the new registration flow. Account linking and existing
  member authentication are not age remediation for known child accounts.
- Create account first sends DOB/country to `/api/account-registration` with action `begin`.
  It does not load Google/Apple JS until the server accepts eligibility. DOB is evaluated
  in request memory, not written into cookies, logs or admission rows.
- Server creates a signed, five-minute `__Host-` Secure/HttpOnly/SameSite=Strict cookie
  containing random flow ID, random nonce and minimal eligibility outcome. It returns
  only the SHA256 nonce plus configured public provider client ID.
- Google Identity Services or Apple JS obtains a fresh ID token. Server verifies RS256
  signature against the provider's fixed JWKS URL, issuer, configured audience, subject,
  freshness and nonce. Token-provided URLs are never followed.
- Server creates a service-only admission with `issue_account_admission`, then exchanges
  the ID token with Supabase's public auth client. The raw nonce stays server-side until
  that exchange. The browser receives session tokens solely to establish its own session,
  with no caching or logging.
- Email registration creates an email-bound admission plus unpredictable proof in
  `signup_admission_token`, then requests OTP. The browser cannot mint its own valid grant.
- The Before User Created hook consumes an unexpired grant. The AFTER INSERT trigger
  binds it to the actual account. Their absence means there is **no complete protection**
  against direct Supabase API calls. UI changes alone must never be advertised as the fix.
- Admission expiry and uniqueness prevent stale-cookie replay. A failed Auth request may
  consume an admission; the user must start a fresh registration rather than weakening
  the one-use requirement.

## Required isolated-environment setup and tests

1. Install migration in a disposable/test Supabase project. Confirm the hook's Postgres
   permissions and configure it as Before User Created. Confirm direct calls to the
   issue RPC/table are denied for anon and authenticated roles. No production users.
2. Confirm actual deployed Supabase version sends authoritative provider `sub` in
   `user_metadata` for Google and Apple new-user hook/insert payloads. The upstream
   source supports this inference; **it is not a substitute for testing the hosted version**.
3. Verify email OTP creates the user with the proof metadata available to both safeguards.
   Verify the insert trigger's consumed-grant binding works before OAuth identity rows are
   inserted. Confirm incomplete inserts roll back and returning/provider-linked accounts
   remain unaffected.
4. Set the dedicated `SIGNUP_ADMISSION_SECRET` (at least 32 high-entropy characters),
   `GOOGLE_SIGNUP_CLIENT_ID`, `APPLE_SIGNUP_CLIENT_ID`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and canonical HTTPS `APP_URL`.
   Both JS provider client IDs must be accepted by the test Supabase provider config.
   Register the site's JS origin with Google and `/login.html` as the Apple JS return
   URL. Apple popup behavior, relay identities, Safari and repeat authorizations must be
   tested. Neither email verification nor Google/Apple identity proves age.
5. `AGE_AUTH_HOOK_READY=true` is an operator deployment interlock, **not an automatic
   proof that hooks are installed**. Enable only after the tests above. Otherwise the
   registration endpoint returns 503. Strict POST Origin must match `APP_URL`; redirect
   alternate domains to the canonical origin rather than broadly allowing arbitrary hosts.
6. Test new and returning Google/Apple/email users, Apple Hide My Email, linked identities,
   direct signUp/OTP/OAuth/ID-token calls, unsupported providers, expired/replayed grants,
   concurrent attempts and account-creation failure after hook consumption. Test the actual
   hosted UI and mobile browsers, not only mocked provider callbacks.
7. Review the US/EU policy and country availability before rollout. With default config,
   only US is available for new independent registration. This limitation is a deployment
   decision/blocker, not approved global exclusion. Update notices and terms separately.

## Operational cautions

- No age/DOB should be added to analytics, logs, URLs, provider metadata or auth logs.
  Supabase's unavoidable auth email metadata contains only an opaque one-use proof.
- Existing known under-13 accounts and daily emails need a separately approved remediation
  and parent-consent plan. This feature does not retroactively authorize their processing.
- Cancel prevents the browser from accepting a late session; it cannot undo an Auth request
  already accepted server-side. Do not automatically delete an account on cancellation.
- Review auth-service email protections and admission rate limits. Signup failures return
  generic messages and must not disclose whether an account exists.
- The current app continues its existing Supabase session storage model. This feature is
  not a migration to cookie-based application sessions.

## Sources checked

- https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/auth/social-sign-in/auth-apple
- https://github.com/supabase/auth/blob/master/internal/api/hooks.go
- https://github.com/supabase/auth/blob/master/internal/api/token_oidc.go

## Mailer and retention details

The public daily form first posts only DOB/country for screening. Only after success
are contact fields displayed. The final submission repeats server-side screening; the
first response is not a reusable credential. Underage final requests produce no pending
subscription or email send. Legacy confirmation tokens without recorded eligibility
must restart signup. Pending screened tokens must match current country/policy at confirmation.

Authenticated mailer activation requires a server-owned account eligibility record matching
the current policy. Legacy members without one can supply their own DOB/country once;
that is distinct from the birthday chosen for the existing daily rhythm. Existing active
subscriptions, journals and sign-in remain untouched. A material policy change may require
support review rather than automatically overwriting historical eligibility.

The expiry check uses the UTC-12 date conservatively so a client timezone cannot admit
someone before their local birthday. Eligibility can therefore be delayed by hours on
the birthday itself. This is a declared-age screen, not proof against lying about age.

Expired admission subjects/opaque proofs are removed after a one-day grace period on
issuance and by the existing five-minute cron when AGE_AUTH_HOOK_READY=true. Cleanup
failures are logged for operator review and do not halt existing mail delivery. Monitor
that purge during activation; if the cron is disabled/misconfigured, bounded retention is
not assured. Final minimal eligibility evidence is retained separately with the account.

The new auth insert trigger also rejects unscreened admin/invitation-created accounts.
Do not activate it without verifying any operational account-creation workflows. This is
not merely a website form change. No migration rewrites existing auth.users or subscribers.

## Deployment order and rollback

Do not merge/deploy this branch merely to get a preview against production credentials.
Use isolated provider applications and a disposable Supabase project first. Run the SQL,
install the Before User Created hook, then configure the server registration settings and
exercise real provider flows and direct API bypass attempts. Only after policy approval,
notice updates and hosted test signoff should production be considered. A coordinated
rollout must account for older cached clients and in-flight mailer confirmation links.

A code-only rollback with the trigger still installed leaves new signup blocked. An Auth
hook-only rollback with the trigger still installed also blocks new users. Removing both
without a replacement restores the prior unguarded creation paths. Existing users need
not be deleted for any rollback. Treat rollback as an explicit operator action, not an
automatic account migration.
