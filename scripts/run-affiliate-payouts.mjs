import { getAdminClient } from "../api/_lib/auth.js";
import {
  deriveAffiliateAccountState,
  sanitizeStripeFailure,
} from "../api/_lib/affiliate.js";
import {
  createAffiliateTransfer,
  getStripeClient,
  retrieveAffiliateAccount,
} from "../api/_lib/stripe.js";

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, value] = arg.slice(2).split("=", 2);
    if (value === undefined) flags.add(key);
    else values.set(key, value);
  });
  return {
    environment: values.get("environment"),
    payoutMonth: values.get("month"),
    dryRun: flags.has("dry-run"),
    confirmProduction: flags.has("confirm-production"),
  };
}

function assertEnvironment(args) {
  if (!["test", "production"].includes(args.environment)) {
    throw new Error("Pass --environment=test or --environment=production.");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.payoutMonth || "")) {
    throw new Error("Pass a payout month as --month=YYYY-MM.");
  }

  const required = [
    "STRIPE_SECRET_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PROJECT_ID",
    "APP_URL",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment: ${missing.join(", ")}`);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const keyMode = /^(sk|rk)_live_/.test(key)
    ? "production"
    : /^(sk|rk)_test_/.test(key)
      ? "test"
      : null;
  if (!keyMode || keyMode !== args.environment) {
    throw new Error("Stripe key mode does not match --environment.");
  }

  const projectHost = new URL(process.env.SUPABASE_URL).hostname;
  const projectId = projectHost.split(".")[0];
  if (projectId !== process.env.SUPABASE_PROJECT_ID) {
    throw new Error("SUPABASE_PROJECT_ID does not match SUPABASE_URL.");
  }

  const appHost = new URL(process.env.APP_URL).hostname;
  if (args.environment === "production" && appHost !== "sineday.app") {
    throw new Error("Production payouts require APP_URL=https://sineday.app.");
  }
  if (
    args.environment === "production" &&
    !args.dryRun &&
    !args.confirmProduction
  ) {
    throw new Error(
      "Live transfers require --confirm-production after reviewing --dry-run.",
    );
  }
}

async function loadCandidates(admin) {
  const { data, error } = await admin
    .from("affiliates")
    .select(
      "id, status, stripe_connect_account_id, stripe_transfers_status, recipient_payouts_status, requirements_status",
    )
    .eq("status", "active")
    .not("stripe_connect_account_id", "is", null);
  if (error) throw new Error("Failed to load payout candidates.");
  return data || [];
}

async function calculateDryRun(admin, affiliateId) {
  const [commissionResult, adjustmentResult] = await Promise.all([
    admin
      .from("affiliate_commissions")
      .select("amount_cents, status, available_at")
      .eq("affiliate_id", affiliateId)
      .is("payout_id", null)
      .in("status", ["pending", "available"]),
    admin
      .from("affiliate_adjustments")
      .select("amount_cents")
      .eq("affiliate_id", affiliateId)
      .eq("status", "pending")
      .is("payout_id", null),
  ]);
  if (commissionResult.error || adjustmentResult.error) {
    throw new Error("Failed to calculate payout preview.");
  }

  const now = Date.now();
  const eligible = (commissionResult.data || []).filter(
    (row) =>
      row.status === "available" ||
      (row.status === "pending" && new Date(row.available_at).getTime() <= now),
  );
  const grossAmountCents = eligible.reduce(
    (sum, row) => sum + row.amount_cents,
    0,
  );
  const adjustmentAmountCents = (adjustmentResult.data || []).reduce(
    (sum, row) => sum + row.amount_cents,
    0,
  );
  return {
    grossAmountCents,
    adjustmentAmountCents,
    netAmountCents: grossAmountCents + adjustmentAmountCents,
    commissionCount: eligible.length,
  };
}

async function failPayout(admin, payoutId, message) {
  const { error } = await admin.rpc("fail_affiliate_payout", {
    p_payout_id: payoutId,
    p_failure_message: message,
  });
  if (error) {
    console.error(`[Affiliate Payout] Could not release payout ${payoutId}.`);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  assertEnvironment(args);
  const admin = getAdminClient();
  const payoutMonth = `${args.payoutMonth}-01`;
  const candidates = await loadCandidates(admin);

  console.log(
    `[Affiliate Payout] environment=${args.environment} project=${process.env.SUPABASE_PROJECT_ID} month=${args.payoutMonth} dryRun=${args.dryRun}`,
  );

  for (const affiliate of candidates) {
    if (args.dryRun) {
      const preview = await calculateDryRun(admin, affiliate.id);
      console.log(
        `[Affiliate Payout] affiliate=${affiliate.id} commissions=${preview.commissionCount} gross=${preview.grossAmountCents} adjustments=${preview.adjustmentAmountCents} net=${preview.netAmountCents}`,
      );
      continue;
    }

    const { data: payout, error: prepareError } = await admin.rpc(
      "prepare_affiliate_payout",
      {
        p_affiliate_id: affiliate.id,
        p_payout_month: payoutMonth,
      },
    );
    if (prepareError) {
      console.error(`[Affiliate Payout] Prepare failed for ${affiliate.id}.`);
      continue;
    }
    if (!payout) continue;
    if (payout.already_paid) {
      console.log(`[Affiliate Payout] Already paid payout=${payout.id}.`);
      continue;
    }

    let transferCreated = false;
    try {
      const account = await retrieveAffiliateAccount(
        payout.stripe_connect_account_id,
      );
      const state = deriveAffiliateAccountState(account, "active");
      if (!state.stripeReady) {
        await failPayout(admin, payout.id, "Connected account is not payout-ready.");
        console.error(`[Affiliate Payout] Account not ready payout=${payout.id}.`);
        continue;
      }

      const stripe = getStripeClient({ connect: true });
      const balance = await stripe.balance.retrieve();
      const availableUsd =
        balance.available.find((item) => item.currency === "usd")?.amount || 0;
      if (availableUsd < payout.net_amount_cents) {
        await failPayout(admin, payout.id, "Insufficient available platform balance.");
        console.error(`[Affiliate Payout] Insufficient balance payout=${payout.id}.`);
        continue;
      }

      const transfer = await createAffiliateTransfer({
        amount: payout.net_amount_cents,
        destination: payout.stripe_connect_account_id,
        metadata: {
          sineday_affiliate_id: affiliate.id,
          sineday_payout_id: payout.id,
          payout_month: args.payoutMonth,
        },
        idempotencyKey: `sineday-affiliate-payout-${payout.id}`,
      });
      transferCreated = true;

      const { error: completeError } = await admin.rpc(
        "complete_affiliate_payout",
        {
          p_payout_id: payout.id,
          p_stripe_transfer_id: transfer.id,
        },
      );
      if (completeError) {
        throw new Error("Transfer created; database finalization must be retried.");
      }
      console.log(
        `[Affiliate Payout] Paid payout=${payout.id} amount=${payout.net_amount_cents}.`,
      );
    } catch (error) {
      if (!transferCreated) {
        await failPayout(admin, payout.id, sanitizeStripeFailure(error));
      }
      console.error(
        `[Affiliate Payout] Failed payout=${payout.id} transferCreated=${transferCreated} message=${error?.message || "Unknown error"}`,
      );
      if (transferCreated) process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error(`[Affiliate Payout] Fatal: ${error.message}`);
  process.exit(1);
});
