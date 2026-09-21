# Public Daily SineDay email rollout

Deploy the public signup only after all dependencies below are ready in the
same environment.

## Database

Apply `supabase/migrations/20260915150000_public_daily_email_signup.sql`.

The migration:

- adds consent and unsubscribe timestamps to the existing subscriber records;
- creates server-only pending-signup, throttle, and welcome-delivery tables;
- enables RLS without browser policies and grants access only to `service_role`;
- installs fixed-`search_path`, service-role-only RPCs for pending requests,
  confirmation, authenticated dashboard activation, welcome recovery, provider
  events, and unsubscribe invalidation.

Do not deploy the API handlers before this migration. Run Supabase security and
performance advisors after applying it.

## Environment

Keep the existing values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `RESEND_WEBHOOK_SECRET`
- `PUBLIC_SITE_URL`
- `UNSUBSCRIBE_SECRET`
- `CRON_SECRET`
- `DAILY_EMAIL_CRON_ENABLED`

Add `MAILER_SIGNUP_SECRET` as a random secret of at least 32 bytes. Use distinct
values per environment. It keys recipient/IP throttle hashes and must remain
server-side.

`PUBLIC_SITE_URL` must be the trusted canonical site origin used for
confirmation and unsubscribe links.

## Resend

Publish `docs/email-templates/20260915/confirmation.html` with the alias
`dailyemailconfirmation` and a required string variable named `CONFIRM_URL`.

Keep these existing published aliases unchanged:

- `welcomeemail`
- all 18 aliases in `api/_lib/daily-email.js`

Keep the existing verified `RESEND_FROM` sender and six-event webhook. The
webhook must continue delivering `email.sent`, `email.delivered`,
`email.failed`, `email.bounced`, `email.complained`, and `email.suppressed` to
`/api/resend/webhook`.

Disable Resend click tracking for the transactional sending domain before
publishing the confirmation template. The confirmation token is intentionally
kept in a URL fragment, and template markup alone is not a substitute for the
provider-level tracking setting.

Run `npm run audit:daily-email-templates` only after the new confirmation
template is published.

## Controlled promotion check

Use one controlled mailbox that is not a production subscriber:

1. Submit `/daily` and verify no auth user, app profile, premium entitlement, or
   affiliate attribution is created.
2. Verify the confirmation email arrives and opening it does not activate
   delivery.
3. Press **Confirm my daily emails** and verify the saved 6:00 AM schedule and
   chosen time zone.
4. Verify `welcomeemail` is accepted once.
5. At the next eligible local recovery window, verify the daily template and
   SineDay number match `origin_day` plus the local civil date.
6. Use the signed unsubscribe action and verify later token replay cannot
   reactivate delivery.

Do not enable a disabled cron or send to an existing production subscriber as
part of this check.
