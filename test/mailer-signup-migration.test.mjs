import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260915150000_public_daily_email_signup.sql",
    import.meta.url
  ),
  "utf8"
);

function functionSql(name) {
  const start = migration.search(new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"));
  assert.ok(start >= 0, `${name} must exist`);
  const end = migration.indexOf("$$;", start);
  assert.ok(end > start, `${name} must have a body`);
  return migration.slice(start, end + 3);
}

test("PostgreSQL special syntax is not schema-qualified", () => {
  assert.doesNotMatch(migration, /\bpg_catalog\.extract\s*\(/i);
});

test("mailer tables are server-only with RLS and explicit grants", () => {
  for (const table of [
    "mailer_signup_requests",
    "mailer_signup_attempts",
    "mailer_suppressions",
    "mailer_welcome_deliveries"
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i")
    );
    assert.match(
      migration,
      new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, "i")
    );
  }
  assert.doesNotMatch(migration, /create policy/i);
});

test("existing subscriber tables remain explicitly server-only", () => {
  for (const table of [
    "subscribers",
    "subscriber_preferences",
    "subscriber_profile",
    "delivery_log"
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i")
    );
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i")
    );
  }
});

test("every privileged mailer RPC has a fixed search path and service-role-only execution", () => {
  const names = [
    "cleanup_mailer_signup_requests",
    "create_mailer_signup_request",
    "mark_mailer_confirmation_sent",
    "mark_mailer_confirmation_failed",
    "confirm_mailer_signup",
    "activate_authenticated_email_subscriber",
    "claim_due_mailer_welcomes",
    "complete_mailer_welcome",
    "is_mailer_welcome_sendable",
    "fail_mailer_welcome",
    "suppress_mailer_recipient",
    "record_mailer_provider_event"
  ];
  for (const name of names) {
    assert.match(functionSql(name), /security invoker\s+set search_path = ''/i, name);
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([^;]*\\) to service_role`, "i"),
      name
    );
  }
});

test("pending creation enforces durable recipient and IP throttles plus cooldown", () => {
  const sql = functionSql("create_mailer_signup_request");
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*p_recipient_key_hash/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*p_ip_key_hash/);
  assert.match(sql, /v_recipient_attempts >= 5/);
  assert.match(sql, /v_ip_hour_attempts >= 20/);
  assert.match(sql, /v_ip_day_attempts >= 100/);
  assert.match(sql, /a\.outcome in \('created', 'sent', 'send_failed'\)/);
  assert.match(sql, /v_last_sent > v_now - interval '10 minutes'/);
  assert.match(sql, /'rate_limited'/);
  assert.match(sql, /'cooldown'/);
  assert.doesNotMatch(sql, /'rate_limited',\s*v_now/);
  assert.doesNotMatch(sql, /'cooldown',\s*v_now/);
  assert.match(sql, /from public\.mailer_suppressions/);
  assert.match(sql, /a\.outcome in \('created', 'sent'\)/);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*p_email/);
});

test("confirmation is serialized, single-use, expiring, and transactional", () => {
  const sql = functionSql("confirm_mailer_signup");
  assert.match(migration, /(?:^|\n)begin;\s*(?:\n|$)/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(sql, /where r\.token_hash = p_token_hash\s+for update/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*v_lock_email/);
  assert.match(sql, /if v_request\.status = 'consumed'/);
  assert.match(sql, /'already_used'/);
  assert.match(sql, /v_request\.expires_at <= v_now/);
  assert.match(sql, /v_request\.status not in \('created', 'pending'\)/);
  assert.match(sql, /from public\.mailer_suppressions/);
  assert.match(sql, /status = 'consumed'/);
  assert.match(migration, /token_hash text not null unique/i);
});

test("concurrent duplicate activation reuses one subscriber identity", () => {
  const sql = functionSql("confirm_mailer_signup");
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*v_lock_email/);
  assert.match(sql, /where s\.email = v_request\.email\s+for update/i);
  assert.match(sql, /insert into public\.subscribers/);
  assert.doesNotMatch(sql, /delete from public\.subscribers/i);
});

test("locked rhythm and active settings are preserved while fresh re-opt-in is explicit", () => {
  const sql = functionSql("confirm_mailer_signup");
  assert.match(sql, /elsif v_profile_birth is null or v_profile_origin is null then/i);
  assert.doesNotMatch(
    sql.slice(sql.indexOf("if v_subscriber.status = 'active'"), sql.indexOf("elsif v_subscriber.status = 'unsubscribed'")),
    /update public\.subscribers/i
  );
  assert.match(sql, /elsif v_subscriber\.status = 'unsubscribed' then[\s\S]*status = 'active'/i);
  assert.match(sql, /email_enabled = true[\s\S]*email_opt_in = true/i);
  assert.doesNotMatch(sql, /sms_enabled\s*=/i);
  assert.doesNotMatch(sql, /sms_opt_in\s*=/i);
  assert.match(sql, /email_opt_in_at = v_now/);
  assert.match(sql, /email_consent_recorded_at = v_now/);
  assert.doesNotMatch(sql, /email_opt_in_at = v_request\.consented_at/);
});

test("fresh activations persist required preferences and use a deadlock-safe lock order", () => {
  const confirmation = functionSql("confirm_mailer_signup");
  const authenticated = functionSql("activate_authenticated_email_subscriber");
  const unsubscribe = functionSql("unsubscribe_email_subscriber");
  assert.match(confirmation, /v_has_preferences := found;\s+if not v_has_preferences/i);
  assert.match(authenticated, /v_has_profile := found;/i);
  assert.match(authenticated, /v_has_preferences := found;\s+if not v_has_preferences/i);
  assert.ok(
    confirmation.indexOf("pg_advisory_xact_lock") <
      confirmation.indexOf("where r.token_hash = p_token_hash\n  for update")
  );
  assert.ok(
    unsubscribe.indexOf("pg_advisory_xact_lock") <
      unsubscribe.indexOf("from public.subscribers s\n  where s.id = p_subscriber_id\n  for update")
  );
});

test("suppression and later unsubscribe prevent token reactivation", () => {
  const confirmation = functionSql("confirm_mailer_signup");
  const unsubscribe = functionSql("unsubscribe_email_subscriber");
  const provider = functionSql("record_mailer_provider_event");
  const suppression = functionSql("suppress_mailer_recipient");
  assert.match(confirmation, /v_subscriber\.status = 'suppressed'/);
  assert.match(
    confirmation,
    /v_request\.created_at <= v_subscriber\.email_unsubscribed_at/
  );
  assert.match(unsubscribe, /email_unsubscribed_at = v_now/);
  assert.match(unsubscribe, /when status = 'suppressed' then 'suppressed'/);
  assert.match(unsubscribe, /status = 'invalidated'/);
  assert.match(provider, /'email\.bounced', 'email\.complained', 'email\.suppressed'/);
  assert.match(provider, /perform public\.suppress_mailer_recipient/);
  assert.match(suppression, /insert into public\.mailer_suppressions/);
  assert.match(suppression, /v_email is null and p_recipient_key_hash is null/);
  assert.match(
    migration,
    /constraint mailer_suppressions_identifier_check\s+check \(email is not null or recipient_key_hash is not null\)/i
  );
  assert.match(suppression, /set status = 'suppressed'/);
  assert.match(suppression, /set email_enabled = false/);
  assert.doesNotMatch(suppression, /email_opt_in = false/);
  assert.match(
    functionSql("activate_authenticated_email_subscriber"),
    /from public\.mailer_suppressions/
  );
  assert.match(provider, /when not v_suppress and status = 'created' then 'pending'/);
  assert.match(provider, /set outcome = 'sent'/);
});

test("welcome sends have a durable unique claim and bounded retry state", () => {
  assert.match(migration, /subscriber_id uuid not null unique references public\.subscribers/i);
  const claim = functionSql("claim_due_mailer_welcomes");
  assert.match(claim, /for update of w skip locked/i);
  assert.match(claim, /w\.attempt_count < 5/);
  assert.match(claim, /w\.status = 'processing'/);
  assert.match(functionSql("is_mailer_welcome_sendable"), /w\.status = 'processing'/);
  assert.match(functionSql("complete_mailer_welcome"), /status = 'sent'/);
  assert.match(functionSql("fail_mailer_welcome"), /attempt_count >= 5 then 'cancelled'/);
  assert.match(migration, /set status = 'pending',\s+attempt_count = 0,\s+last_attempt_at = null/i);
});

test("expired payload cleanup retains token and provider evidence", () => {
  const sql = functionSql("cleanup_mailer_signup_requests");
  assert.match(sql, /status = 'expired'/);
  assert.match(sql, /email = null/);
  assert.match(sql, /birth_day_of_year = null/);
  assert.doesNotMatch(sql, /delete from public\.mailer_signup_requests/i);
  assert.doesNotMatch(sql, /confirmation_provider_message_id = null/i);
  assert.match(sql, /delete from public\.mailer_signup_attempts[\s\S]*interval '30 days'/i);
});
