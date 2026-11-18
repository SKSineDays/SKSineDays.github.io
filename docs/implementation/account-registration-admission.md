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
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and canonical HTTPS
   `SIGNUP_APP_URL` (falls back to existing `APP_URL` only when not set). Keep legacy
   `APP_URL` and old OAuth flows unchanged. For the current apex-to-www redirect,
   the new-flow override must be `https://www.sineday.app`.
   Both JS provider client IDs must be accepted by the test Supabase provider config.
   Register the site's JS origin with Google and `/login.html` as the Apple JS return
   URL. Apple popup behavior, relay identities, Safari and repeat authorizations must be
   tested. Neither email verification nor Google/Apple identity proves age.
5. `AGE_AUTH_HOOK_READY=true` is an operator deployment interlock, **not an automatic
   proof that hooks are installed**. Enable only after the tests above. Otherwise the
   registration endpoint returns 503. Strict POST Origin must match `SIGNUP_APP_URL` (or its `APP_URL` fallback); redirect
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


## Existing-owner one-time check (draft revision)

A new auth-bound `/api/account-eligibility` endpoint and dashboard interruption check
run before member data loads. Missing owners enter their own DOB/country once, distinct
from family profiles. The service-only atomic decision RPC stores `eligible` or
`review_required`, never full DOB. Opposite retries, another device, and concurrent
submissions cannot overwrite the first result. Mistakes require support review; this
is not a permanent suspension, data deletion, parental-consent flow or age verification.
The dialog keeps support and existing Stripe billing management accessible. Stripe's
portal configuration controls what actions are offered; no new checkout is invoked.

Database enforcement adds an AND/RESTRICTIVE authenticated policy to every currently
RLS-enabled public base table, plus storage.objects, without replacing ownership policies.
A narrow SECURITY DEFINER predicate checks only auth.uid() against server-owned evidence
and current DB policy configuration. The live catalog audit found planner_tasks and
planner_task_completions absent from versioned history; the generic policy covers them.
No public views were found. Existing public authenticated-callable non-trigger functions
are SECURITY INVOKER. New tables/views/RPCs require a fresh exposure audit.

Privileged protected API routes use a server guard before application access, including
prints, export, social, globe, affiliates and new checkout. Explicit safe controls remain:
identity status, account entitlements, billing reconciliation/portal, existing affiliate
payout dashboard, eligibility, sign-out, support, email-status and unsubscribe. New mailer
activation requires immutable eligible status. Background mail/Stripe processing is not
age-gated or modified by an owner denial. Previously issued signed image URLs can remain
valid for 15 minutes, print URLs for 10 minutes; downloaded content cannot be recalled.

### Additional activation blockers

- DB `account_age_enforcement.enabled` defaults false; server
  `AGE_EXISTING_ENFORCEMENT_READY` defaults off. Neither alone enables complete coverage.
- Synchronize DB `account_age_policy_config` with reviewed server
  `AGE_ELIGIBILITY_POLICIES_JSON`. Both validate exact policy version/minimum.
- No EU defaults have been selected. Review unsupported-country handling before rollout.
- Test old JWTs/direct REST, both RPCs, all storage operations, each privileged API,
  identity changes, ambiguous submissions, existing billing cancellation and unsubscribe.
- Test real hosted RLS/storage roles; PGlite SQL and mocked route tests are not hosted proof.
- Authorize an audited support correction/parental-consent procedure before activation.
  The current implementation intentionally does not expose a self-service overwrite.
- Do not use a Vercel preview with production credentials as an isolated test environment.
- No child/owner records or saved content were read or changed in the catalog audit.


## Authorized dormant production staging, 2026-11-18

Owner explicitly authorized testing within the existing project, no new paid project.
The revised migration was installed as stage_dormant_account_age_eligibility. Both
account_signup_enforcement.enabled and account_age_enforcement.enabled remain FALSE.
Before User Created hook remains unconfigured. No frontend or Vercel configuration was
changed. Signup hook/insert trigger now return without enforcement when the separate
signup switch is false; new registration endpoint refuses both begin/complete until it
is true. The prior warning about unconditional staging blockage is superseded by this
revised guard, not permission to enable untested signup.

Hosted rollback-only SQL smoke passed after correcting a test-fixture email mismatch:
dormant auth insertion, missing admission denial, valid email-bound admission, eligibility
binding, missing owner denial, immutable underage review, eligible-owner predicate.
All synthetic rows and temporary switches rolled back. Postcheck:8 auth accounts,
7 subscribers,5 active/not-unsubscribed,0 decisions,0 admissions; both flags FALSE.
No actual provider/OTP flow or outbound email was exercised. SQL fixture uses reserved
example.invalid addresses and never sends mail.

Storage policy creation succeeded via the migration service without granting roles or
changing ownership.42 new restrictive policies include storage.objects. Existing policy
names/targets were recorded before staging. Security advisor warns on the intentional
no-argument SECURITY DEFINER own-account predicate; fixed search_path, auth.uid(), no
arbitrary-user parameter, and no client metadata are the intended narrow boundary.

Latest visible physical backup:2026-11-18 12:38:27 UTC. Storage objects excluded; restore
not tested. Do not use backup restoration for ordinary rollback, which would lose newer
user writes. Precise non-destructive emergency script:scripts/age/deactivate-staged-age.sql.
It disables both controls and removes only the new trigger/policies, retaining all user,
subscriber and eligibility data. Local PGlite rollback test verifies retention and original
policy preservation. Normal deactivation only needs switches off, application flags off,
and Auth hook unconfigured. Never turn off signup enforcement while the new signup UI
is advertised as protected.

Remaining:real provider/OTP config and end-to-end tests, verified founder canary identity,
EU availability policy, approved support correction process, coordinated app deployment.
Vercel dashboard signed in but age secrets/client IDs not yet configured. No global
activation or readiness claim.


### Provider/origin inspection
Google and Apple are enabled in Supabase; Google nonce checking is on. Existing OAuth
callback uses auth.sineday.app. Supabase site URL and production redirects currently
use apex sineday.app, while the live website redirects apex to www.sineday.app.
Set dedicated SIGNUP_APP_URL only after verifying the intended testing/production
origin; this does not change legacy APP_URL or old OAuth callbacks. Keep exact origin
checks. Add only the corresponding explicit callback to Supabase and verify Google JS
origin and Apple JS return URL in their provider consoles before real testing.
Google Cloud console is unavailable in current cloud browser; Apple Developer needs
sign-in. No provider-console or redirect changes were made. The current preview form
renders correctly but registration remains deliberately blocked by dormant settings.

Fresh remote main is an ancestor of the PR head and git merge-tree reports no conflicts.
Connector mergeable:false is not evidence of a source conflict; keep draft/check gates,
do not force-rewrite history or mark ready just to change this status.

## Backward-compatible dormant application deployment

The application now preserves original sign-in/signup behavior while readiness is off.
`AGE_AUTH_HOOK_READY` controls the separate Create Account panel and whether the existing
email link may create a user. Its protected endpoint still requires BOTH valid secret/
provider configuration and database signup enforcement. Legacy OAuth remains available;
when database enforcement is on, its new-account attempts without admission are denied.
A stale/off client setting cannot defeat that database boundary. No age protection is
claimed while both signup controls are off.

`AGE_MAILER_ENFORCEMENT_READY` is a separate explicit mailer setting. All three mutation
routes (public signup, public confirmation, authenticated activation) require exact
agreement with service-only `mailer_age_enforcement_is_enabled()` before proceeding.
Missing RPC, read error, nonboolean result or either disagreement returns503; it does
not choose the legacy branch. Install the additive dormant-mailer migration BEFORE
this application deployment. The database flag defaults false.

- Both false: original create/confirm/activation RPCs, no-country public signup and
  existing pending confirmations continue to work. No eligibility decision is needed.
- Both true: age-first public signup, eligible confirmation and eligible authenticated
  activation. Legacy RPCs are denied by the additional database boundary.
- Mismatch: unavailable without consuming tokens, activating recipients or sending mail.

The public config exposes booleans only; it is display/flow selection, never authority.
The daily form remains disabled if configuration cannot load. The registration panel
is hidden unless explicitly enabled; provider SDKs do not load in dormant mode.
`/api/account-eligibility` now refuses GET/POST before authentication/database access
unless `AGE_EXISTING_ENFORCEMENT_READY=true`. This prevents accidental immutable owner
records while the owner check is dormant. It is not a founder-canary consent mechanism.

Pending legacy email confirmations require an explicit activation plan: after enabling
mailer enforcement they cannot bypass eligibility. Existing active subscriptions,
ongoing deliveries, unsubscribe and billing management are not altered by these guards.
Rollback disables corresponding application/database flags together; disagreement is
intentionally unavailable rather than permissive. Do not enable production flags merely
to test deployment. Provider/OTP and hosted full-path checks are still prerequisites.
