import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchClaimedWelcomeEmails
} from "../api/_lib/welcome-email.js";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DELIVERY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claims = [{
  delivery_id: DELIVERY_ID,
  subscriber_id: SUBSCRIBER_ID,
  email: "delivered@example.com"
}];

const env = {
  RESEND_FROM: "Daily <daily@daily.sineday.app>",
  UNSUBSCRIBE_SECRET: "unsubscribe-secret-test-key",
  PUBLIC_SITE_URL: "https://sineday.app"
};

test("welcome send records its provider ID and uses the durable subscriber idempotency key", async () => {
  const rpcCalls = [];
  const sends = [];
  const counts = await dispatchClaimedWelcomeEmails({
    claims,
    supabase: {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      }
    },
    resend: {
      emails: {
        async send(payload, options) {
          sends.push({ payload, options });
          return { data: { id: "provider_welcome_1" }, error: null };
        }
      }
    },
    env,
    sleep: async () => {}
  });

  assert.deepEqual(counts, { sent: 1, failed: 0, skipped: 0 });
  assert.equal(sends[0].options.idempotencyKey, `sineday-welcome/${SUBSCRIBER_ID}`);
  assert.equal(sends[0].payload.template.id, "welcomeemail");
  assert.deepEqual(rpcCalls[0], {
    name: "complete_mailer_welcome",
    args: {
      p_delivery_id: DELIVERY_ID,
      p_provider_message_id: "provider_welcome_1"
    }
  });
});

test("known provider failures persist a bounded retry state without reporting success", async () => {
  const rpcCalls = [];
  const counts = await dispatchClaimedWelcomeEmails({
    claims,
    supabase: {
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      }
    },
    resend: {
      emails: {
        async send() {
          return {
            data: null,
            error: { message: "failed for private@example.com at https://secret.invalid" }
          };
        }
      }
    },
    env,
    sleep: async () => {}
  });

  assert.deepEqual(counts, { sent: 0, failed: 1, skipped: 0 });
  const failure = rpcCalls.find((call) => call.name === "fail_mailer_welcome");
  assert.ok(failure);
  assert.equal(failure.args.p_error.includes("@"), false);
  assert.equal(failure.args.p_error.includes("http"), false);
});
