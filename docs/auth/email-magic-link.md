# Email magic-link sign-in

The existing login screen uses the shared Supabase client and `signInWithOtp`
with `shouldCreateUser: true` and the existing configured callback URL. Supabase
and its configured SMTP provider send the email; SineDay does not send or verify
an OTP itself. Provider settings, tables, entitlements and daily mailers are unchanged.

The callback owns token/code processing, disables automatic URL consumption on
that page, removes the callback query/fragment from browser history, and exchanges
only the parsed PKCE code (or establishes the fragment session) once. Success
requires a returned session. Errors are fixed, non-sensitive messages. The callback
is excluded from analytics and service-worker caching; cache version is v39.

## Account continuity

For an existing confirmed Google/Apple account, use the exact email stored on that
Supabase account. Supabase's MagicLink handler looks up the user by email/audience
and sends the link for the existing user ID. The application never merges or moves
member data. This is verified against provider source, not a live production-account
test. An Apple private-relay address and a personal address are different addresses;
using a different address may create a separate new account. The login screen tells
Hide My Email users to continue with Apple. No universal same-person/different-email
matching is promised or attempted.

Sources reviewed November 2, 2026:
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://github.com/supabase/auth/blob/master/internal/api/magic_link.go
- https://github.com/supabase/auth/blob/master/internal/models/user.go
- https://github.com/supabase/auth-js/blob/master/src/GoTrueClient.ts
- https://support.apple.com/en-us/105078

## Focused local verification

Run `node --test test/email-magic-link.test.mjs` (22 tests). This covers normalized
requests, invalid email, simultaneous-submit prevention, safe rate-limit/provider
feedback, delayed/failed initialization, callback variants and failures, preserved
OAuth/linking arguments, and network-only callback/API service-worker behavior.
SDK calls are stubbed. Syntax checks and `git diff --check` also pass.

A local Chromium run for 375px/1440px layouts was attempted but could not launch
because the execution environment rejects Chromium's process-singleton socket.
An approved elevated retry had the same result. Responsive CSS/semantics were
inspected and statically tested, but visual/browser checks have NOT passed.

## Stephen's production test after merge/deployment

1. Open login on iPhone and desktop, confirm no clipping and keyboard/focus behavior.
2. Request a link for a new test account, open the branded email, confirm dashboard.
3. Request a link for the exact confirmed email of an existing Google account and,
   separately, an existing non-relay Apple account. Confirm the same Supabase user ID
   and existing owner/saved profiles, journal/history, subscription, affiliate status
   and daily-email preferences. Do not use a different address to test continuity.
4. Confirm Google and Apple sign-in and explicit Apple identity linking still work.
5. Open an expired/reused link: friendly login message, no codes/tokens in logs/UI.
6. Confirm an installed PWA updates to v39; callback visits must require network.

No production email was sent or real auth account modified during automated checks.
Cross-device PKCE requires the original browser's verifier; the current shared client
retains its existing implicit-flow default. Do not change template/flow settings as
part of this patch. Never merge automatically. Keep `[skip ci]` in the final merge
commit if GitHub Actions must remain unused.
