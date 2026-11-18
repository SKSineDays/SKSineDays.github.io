# Narrow authenticated email signup canary

This is a REAL signup path, not the no-write provider diagnostic. It creates a retained
Auth account and requests a real sign-in email only after the authorized operator enters
the actual intended account owner's age/country declaration and clicks the final button.
It does not change global enforcement, mail subscriptions, billing, or existing profiles.
Do not assume successful HTTP response proves delivery, callback or hosted hook behavior.

## Configuration and authorization

- Additive canary SQL migration must be installed and independently verified first.
- Supabase Before User Created hook must call the scoped eligibility function for the
  canary attempt. Keep global enforcement switches OFF. Without the hook consuming the
  valid admission, the insert trigger intentionally rejects the canary creation. Verify
  hook wiring and exact target with rollback-only negatives before requesting real email.
- Service-owned canary row binds one verified operator Auth UUID to one exact normalized
  email, explicit expiry and a stable canary ID. No personal identifiers are hardcoded in
  this repository. The target must be absent from Auth at issuance.
- `SIGNUP_CANARY_ENABLED=true` enables only this scoped test endpoint; absent/false
  returns404 before Auth/DB work. This is NOT global age enforcement. Disable it first
  when ending the test; retain any created account and eligibility proof.
- `SIGNUP_CANARY_SECRET`: separate random >=32-character secret; do not reuse registration
  or provider-diagnostic secrets. No global readiness flag is enabled for this path.
- `SIGNUP_APP_URL` sets the exact canonical HTTPS browser origin; legacy `APP_URL` is not
  changed. Corresponding `/auth/callback.html` must be allowed by Supabase Auth.
- Existing Supabase server/service and anon configuration is required. The service key
  never reaches the browser. The browser's authenticated bearer token is revalidated for
  every action; neither posted operator IDs nor posted target emails grant authority.

## Manual flow

Open `/signup-canary.html` while signed in as the explicitly authorized operator. The
server shows only that operator's configured target. Enter the real owner's birthdate
and residence, then review the target and click **Create test account and send email**.
The birthdate is cleared and is not stored in the signed cookie or admission. Current
policy remains US13 independent accounts; no EU or worldwide default is introduced.

The server uses a separate HttpOnly Secure SameSite cookie, binding operator, canary ID,
email hash, approved policy and expiry. Completion rechecks the active scope and policy.
The single-use issuance RPC atomically binds the server-selected target and refuses an
existing account, reused scope, expired scope or missing eligibility. Returned target is
checked against the signed hash before the Auth OTP request.

One issuance is allowed, including when downstream OTP response is uncertain. No automatic
retry/reset/account deletion is provided. Inspect the exact authorized test state before
any further owner-approved action. A newly created account is retained. Opening its link
can replace the operator's browser session: use a separate browser profile if desired.

## Boundaries and verification

No test email, account creation or migration is performed by the synthetic tests. Test
fixtures use example.invalid addresses. Route tests cover authorization, exact origin,
underage denial, absent/tampered/rebound proof, one-shot behavior, target mismatch and
uncertain delivery. SQL tests independently cover missing-grant rejection for the scoped
target with the global flag off and ordinary noncanary behavior. Real hosted email and
callback verification remains a separately authorized step.

The page is unlinked, noindex, no-store, non-embeddable, excluded from service-worker
caching and analytics. It uses the ordinary signed-in session only; no Google/Apple
creation variant is added. Global-off behavior for unrelated signup remains unchanged.
