import { getAdminClient } from "../api/_lib/auth.js";
import { randomUUID } from "node:crypto";
import {
  deriveAffiliateAccountState,
  sanitizeStripeFailure,
} from "../api/_lib/affiliate.js";
import {
  createAffiliateTransfer,
  findAffiliateTransfers,
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
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (args.payoutMonth > currentMonth) {
    throw new Error("Payout month cannot be in the future.");
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
    .not("stripe_connect_account_id", "is", null);
  if (error) throw new Error("Failed to load payout candidates.");
  return data || [];
}

async function calculateDryRun(admin, affiliateId, payoutMonth) {
  const [commissionResult, adjustmentResult] = await Promise.all([
    admin
      .from("affiliate_commissions")
      .select("amount_cents, status, available_at, created_at")
      .eq("affiliate_id", affiliateId)
      .is("payout_id", null)
      .in("status", ["pending", "available"]),
    admin
      .from("affiliate_adjustments")
      .select("amount_cents, created_at")
      .eq("affiliate_id", affiliateId)
      .eq("status", "pending")
      .is("payout_id", null),
  ]);
  if (commissionResult.error || adjustmentResult.error) {
    throw new Error("Failed to calculate payout preview.");
  }

  const now = Date.now();
  const [year, month] = payoutMonth.split("-").map(Number);
  const eligibilityCutoff = Math.min(now, Date.UTC(year, month, 1));
  const eligible = (commissionResult.data || []).filter(
    (row) =>
      new Date(row.available_at).getTime() < eligibilityCutoff &&
      new Date(row.created_at).getTime() <= eligibilityCutoff &&
      (row.status === "available" ||
        (row.status === "pending" && new Date(row.available_at).getTime() <= now)),
  );
  const grossAmountCents = eligible.reduce(
    (sum, row) => sum + row.amount_cents,
    0,
  );
  const adjustmentAmountCents = (adjustmentResult.data || [])
    .filter((row) => new Date(row.created_at).getTime() <= eligibilityCutoff)
    .reduce(
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

async function failPayout(admin, payoutId, claimToken, message) {
  const { data, error } = await admin.rpc("fail_affiliate_payout", {
    p_payout_id: payoutId,
    p_claim_token: claimToken,
    p_failure_message: message,
  });
  if (error || data !== true) {
    console.error(`[Affiliate Payout] Could not release payout ${payoutId}.`);
    return false;
  }
  return true;
}

async function completePayout(admin, payoutId, claimToken, transferId) {
  const { data, error } = await admin.rpc("complete_affiliate_payout", {
    p_payout_id: payoutId,
    p_claim_token: claimToken,
    p_stripe_transfer_id: transferId,
  });
  if (error || data !== true) {
    throw new Error("Transfer exists; database finalization must be retried.");
  }
}

function isDefinitiveStripeFailure(error) {
  return new Set([
    "StripeInvalidRequestError",
    "StripePermissionError",
    "StripeAuthenticationError",
    "StripeCardError",
  ]).has(error?.type);
}

async function inspectExistingTransfer(payout, affiliate, args) {
  const transfers = await findAffiliateTransfers(payout.id);
  if (!transfers.length) return { status: "none", transfer: null };
  if (transfers.length !== 1) return { status: "invalid", transfer: null };

  const transfer = transfers[0];
  const destination =
    typeof transfer.destination === "string"
      ? transfer.destination
      : transfer.destination?.id;
  const valid =
    transfer.amount === payout.net_amount_cents &&
    transfer.amount_reversed === 0 &&
    transfer.currency === "usd" &&
    transfer.livemode === (args.environment === "production") &&
    destination === payout.stripe_destination_account_id &&
    transfer.metadata?.sineday_affiliate_id === affiliate.id &&
    transfer.metadata?.sineday_payout_id === payout.id &&
    transfer.metadata?.payout_month === args.payoutMonth;
  return { status: valid ? "valid" : "invalid", transfer };
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
      if (affiliate.status !== "active") continue;
      const preview = await calculateDryRun(admin, affiliate.id, args.payoutMonth);
      console.log(
        `[Affiliate Payout] affiliate=${affiliate.id} commissions=${preview.commissionCount} gross=${preview.grossAmountCents} adjustments=${preview.adjustmentAmountCents} net=${preview.netAmountCents}`,
      );
      continue;
    }

    const claimToken = randomUUID();
    const { data: payout, error: prepareError } = await admin.rpc(
      "prepare_affiliate_payout",
      {
        p_affiliate_id: affiliate.id,
        p_payout_month: payoutMonth,
        p_claim_token: claimToken,
        p_lease_seconds: 300,
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

    let transferRequestStarted = Boolean(payout.transfer_request_started_at);
    let failureResolved = false;
    try {
      const existing = await inspectExistingTransfer(payout, affiliate, args);
      if (existing.status === "invalid") {
        console.error(
          `[Affiliate Payout] Manual reconciliation required payout=${payout.id}; transfer metadata did not match the payout snapshot.`,
        );
        process.exitCode = 1;
        continue;
      }
      if (existing.status === "valid") {
        await completePayout(
          admin,
          payout.id,
          claimToken,
          existing.transfer.id,
        );
        console.log(
          `[Affiliate Payout] Reconciled payout=${payout.id} transfer=${existing.transfer.id}.`,
        );
        continue;
      }

      if (transferRequestStarted) {
        const requestAgeMs =
          Date.now() - new Date(payout.transfer_request_started_at).getTime();
        if (requestAgeMs >= 20 * 60 * 60 * 1000) {
          console.error(
            `[Affiliate Payout] Manual reconciliation required payout=${payout.id}; automatic transfer retry window expired.`,
          );
          process.exitCode = 1;
          continue;
        }
      }

      if (!transferRequestStarted && affiliate.status !== "active") {
        await failPayout(
          admin,
          payout.id,
          claimToken,
          "Affiliate is no longer active.",
        );
        continue;
      }

      const account = await retrieveAffiliateAccount(
        payout.stripe_destination_account_id,
      );
      const state = deriveAffiliateAccountState(account, "active");
      const expectedLivemode = args.environment === "production";
      const recipientOnly =
        account.applied_configurations?.length === 1 &&
        account.applied_configurations[0] === "recipient";
      const metadataMatches =
        account.metadata?.integration === "sineday_affiliate" &&
        account.metadata?.sineday_affiliate_id === affiliate.id;
      if (
        account.id !== payout.stripe_destination_account_id ||
        account.livemode !== expectedLivemode ||
        !recipientOnly ||
        !metadataMatches
      ) {
        if (!transferRequestStarted) {
          await failPayout(
            admin,
            payout.id,
            claimToken,
            "Connected account ownership verification failed.",
          );
        } else {
          process.exitCode = 1;
        }
        console.error(`[Affiliate Payout] Account ownership failed payout=${payout.id}.`);
        continue;
      }

      if (!transferRequestStarted && !state.stripeReady) {
        await failPayout(
          admin,
          payout.id,
          claimToken,
          "Connected account is not payout-ready.",
        );
        console.error(`[Affiliate Payout] Account not ready payout=${payout.id}.`);
        continue;
      }

      const stripe = getStripeClient({ connect: true });
      if (!transferRequestStarted) {
        const balance = await stripe.balance.retrieve();
        const availableUsd =
          balance.available.find((item) => item.currency === "usd")?.amount || 0;
        if (availableUsd < payout.net_amount_cents) {
          await failPayout(
            admin,
            payout.id,
            claimToken,
            "Insufficient available platform balance.",
          );
          console.error(`[Affiliate Payout] Insufficient balance payout=${payout.id}.`);
          continue;
        }
      }

      const { data: marked, error: markError } = await admin.rpc(
        "mark_affiliate_payout_transfer_started",
        {
          p_payout_id: payout.id,
          p_claim_token: claimToken,
        },
      );
      if (markError || marked !== true) {
        throw new Error("Payout lease was lost before transfer.");
      }
      transferRequestStarted = true;

      const transfer = await createAffiliateTransfer({
        amount: payout.net_amount_cents,
        destination: payout.stripe_destination_account_id,
        metadata: {
          sineday_affiliate_id: affiliate.id,
          sineday_payout_id: payout.id,
          payout_month: args.payoutMonth,
        },
        idempotencyKey: `sineday-affiliate-payout-${payout.id}`,
      });

      await completePayout(admin, payout.id, claimToken, transfer.id);
      console.log(
        `[Affiliate Payout] Paid payout=${payout.id} amount=${payout.net_amount_cents}.`,
      );
    } catch (error) {
      if (!transferRequestStarted) {
        await failPayout(
          admin,
          payout.id,
          claimToken,
          sanitizeStripeFailure(error),
        );
      } else if (isDefinitiveStripeFailure(error)) {
        try {
          const existing = await inspectExistingTransfer(payout, affiliate, args);
          if (existing.status === "invalid") {
            throw new Error("Transfer reconciliation found a snapshot mismatch.");
          }
          if (existing.status === "valid") {
            await completePayout(
              admin,
              payout.id,
              claimToken,
              existing.transfer.id,
            );
            transferRequestStarted = false;
            failureResolved = true;
          } else {
            const { data: released, error: releaseError } = await admin.rpc(
              "fail_affiliate_payout_after_reconciliation",
              {
                p_payout_id: payout.id,
                p_claim_token: claimToken,
                p_failure_message: sanitizeStripeFailure(error),
              },
            );
            if (releaseError || released !== true) {
              throw new Error("Definitive transfer failure could not be released.");
            }
            transferRequestStarted = false;
            failureResolved = true;
          }
        } catch (reconcileError) {
          console.error(
            `[Affiliate Payout] Reconciliation failed payout=${payout.id} message=${reconcileError.message}`,
          );
        }
      }
      const log = failureResolved ? console.log : console.error;
      log(
        `[Affiliate Payout] ${failureResolved ? "Reconciled failure" : "Failed"} payout=${payout.id} transferRequestStarted=${transferRequestStarted} message=${error?.message || "Unknown error"}`,
      );
      if (transferRequestStarted) process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error(`[Affiliate Payout] Fatal: ${error.message}`);
  process.exit(1);
});
