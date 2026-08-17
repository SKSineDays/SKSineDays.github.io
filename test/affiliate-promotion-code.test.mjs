import test from "node:test";
import assert from "node:assert/strict";
import {
  collectPromotionCodeIds,
  getAffiliateCouponId,
  getPromotionCouponId,
  isStripePromotionCodeId,
} from "../api/_lib/affiliate.js";
import {
  applyAffiliateCheckoutMode,
  ensureAffiliatePromotionCode,
  recordAffiliateAttributionFromPromotion,
  recoverAffiliateAttributionFromInvoice,
  resolveCheckoutAffiliateReferral,
  retrieveCheckoutPromotionCodeIds,
  retrieveInvoicePromotionCodeIds,
  syncAffiliatePromotionCodeState,
} from "../api/_lib/affiliate-server.js";

const couponId = "coupon_affiliate_master";
const affiliateBase = {
  id: "aff_ra420",
  user_id: "aff_user_1",
  code: "RA420",
  status: "active",
  stripe_promotion_code_id: null,
  stripe_promotion_code_created_at: null,
};

function createAffiliateStore(initial = affiliateBase) {
  const row = { ...initial };
  return {
    row,
    from(table) {
      assert.equal(table, "affiliates");
      return {
        update(payload) {
          return {
            eq(field, value) {
              assert.equal(field, "id");
              assert.equal(value, row.id);
              return {
                is(nullField, nullValue) {
                  assert.equal(nullField, "stripe_promotion_code_id");
                  assert.equal(nullValue, null);
                  return {
                    select() {
                      return {
                        async maybeSingle() {
                          if (row.stripe_promotion_code_id) {
                            return { data: null, error: null };
                          }
                          Object.assign(row, payload);
                          return { data: { ...row }, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        select() {
          return {
            eq(field, value) {
              return {
                async maybeSingle() {
                  if (field === "id" && value === row.id) {
                    return { data: { ...row }, error: null };
                  }
                  if (field === "code" && value === row.code) {
                    return { data: { ...row }, error: null };
                  }
                  if (
                    field === "stripe_promotion_code_id" &&
                    value === row.stripe_promotion_code_id
                  ) {
                    return { data: { ...row }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function createStripePromotionMock({
  existing = [],
  createResult,
  createError,
} = {}) {
  const calls = {
    list: [],
    create: [],
    update: [],
  };
  return {
    calls,
    promotionCodes: {
      async list(params) {
        calls.list.push(params);
        return { data: existing };
      },
      async create(params, options) {
        calls.create.push({ params, options });
        if (createError) throw createError;
        return createResult;
      },
      async update(id, params) {
        calls.update.push({ id, params });
        return { id, ...params, coupon: { id: couponId }, code: "RA420" };
      },
    },
  };
}

test("affiliate coupon id stays server-side and is never empty-string truthy", () => {
  const previous = process.env.STRIPE_AFFILIATE_COUPON_ID;
  delete process.env.STRIPE_AFFILIATE_COUPON_ID;
  assert.equal(getAffiliateCouponId(), null);
  process.env.STRIPE_AFFILIATE_COUPON_ID = "  coupon_live  ";
  assert.equal(getAffiliateCouponId(), "coupon_live");
  process.env.STRIPE_AFFILIATE_COUPON_ID = previous;
});

test("only Stripe promotion code IDs are treated as attribution keys", () => {
  assert.equal(isStripePromotionCodeId("promo_123"), true);
  assert.equal(isStripePromotionCodeId("di_123"), false);
  assert.equal(isStripePromotionCodeId({ id: "promo_abc" }), true);
  assert.deepEqual(
    collectPromotionCodeIds({
      session: { discounts: [{ promotion_code: "promo_session" }] },
      subscription: {
        discount: { promotion_code: { id: "promo_sub" } },
        discounts: ["di_ignored", { promotion_code: "promo_sub_list" }],
      },
      invoice: {
        discount: { promotion_code: "promo_invoice" },
        discounts: ["di_also_ignored"],
      },
    }),
    ["promo_session", "promo_sub", "promo_sub_list", "promo_invoice"],
  );
  assert.equal(getPromotionCouponId({ coupon: { id: couponId } }), couponId);
});

test("ensureAffiliatePromotionCode returns a stored ID without Stripe calls", async () => {
  const stripe = createStripePromotionMock();
  const result = await ensureAffiliatePromotionCode({
    stripe,
    supabaseAdmin: createAffiliateStore({
      ...affiliateBase,
      stripe_promotion_code_id: "promo_existing",
    }),
    affiliate: {
      ...affiliateBase,
      stripe_promotion_code_id: "promo_existing",
    },
    couponId,
  });
  assert.equal(result.promotionCodeId, "promo_existing");
  assert.equal(result.created, false);
  assert.equal(stripe.calls.list.length, 0);
  assert.equal(stripe.calls.create.length, 0);
});

test("ensureAffiliatePromotionCode adopts an existing Stripe code for the master coupon", async () => {
  const supabaseAdmin = createAffiliateStore();
  const stripe = createStripePromotionMock({
    existing: [
      {
        id: "promo_found",
        code: "RA420",
        active: true,
        coupon: { id: couponId },
      },
    ],
  });
  const result = await ensureAffiliatePromotionCode({
    stripe,
    supabaseAdmin,
    affiliate: affiliateBase,
    couponId,
    now: () => "2026-08-17T00:00:00.000Z",
  });
  assert.equal(result.promotionCodeId, "promo_found");
  assert.equal(supabaseAdmin.row.stripe_promotion_code_id, "promo_found");
  assert.equal(stripe.calls.create.length, 0);
});

test("ensureAffiliatePromotionCode refuses a same-text code on a different coupon", async () => {
  const stripe = createStripePromotionMock({
    existing: [
      {
        id: "promo_other",
        code: "RA420",
        coupon: { id: "coupon_welcome" },
      },
    ],
  });
  await assert.rejects(
    () =>
      ensureAffiliatePromotionCode({
        stripe,
        supabaseAdmin: createAffiliateStore(),
        affiliate: affiliateBase,
        couponId,
      }),
    /not tied to the SineDay Affiliate coupon/,
  );
  assert.equal(stripe.calls.create.length, 0);
});

test("ensureAffiliatePromotionCode creates and persists a new Stripe promotion code", async () => {
  const supabaseAdmin = createAffiliateStore();
  const stripe = createStripePromotionMock({
    createResult: {
      id: "promo_created",
      code: "RA420",
      active: true,
      coupon: { id: couponId },
    },
  });
  const result = await ensureAffiliatePromotionCode({
    stripe,
    supabaseAdmin,
    affiliate: affiliateBase,
    couponId,
    now: () => "2026-08-17T00:00:00.000Z",
  });
  assert.equal(result.promotionCodeId, "promo_created");
  assert.equal(stripe.calls.create[0].params.coupon, couponId);
  assert.equal(stripe.calls.create[0].params.code, "RA420");
  assert.deepEqual(stripe.calls.create[0].params.metadata, {
    sineday_affiliate_id: "aff_ra420",
    sineday_affiliate_code: "RA420",
  });
  assert.equal(
    stripe.calls.create[0].options.idempotencyKey,
    "sineday-affiliate-promo-aff_ra420",
  );
});

test("ensureAffiliatePromotionCode retries into an existing code after a create race", async () => {
  const supabaseAdmin = createAffiliateStore();
  let listedOnce = false;
  const stripe = {
    promotionCodes: {
      async list() {
        if (!listedOnce) {
          listedOnce = true;
          return { data: [] };
        }
        return {
          data: [
            {
              id: "promo_raced",
              code: "RA420",
              coupon: { id: couponId },
              active: true,
            },
          ],
        };
      },
      async create() {
        throw new Error("resource_already_exists");
      },
      async update() {
        throw new Error("should not update");
      },
    },
  };
  const result = await ensureAffiliatePromotionCode({
    stripe,
    supabaseAdmin,
    affiliate: affiliateBase,
    couponId,
  });
  assert.equal(result.promotionCodeId, "promo_raced");
});

test("ensureAffiliatePromotionCode rejects inactive affiliates and missing coupon config", async () => {
  await assert.rejects(
    () =>
      ensureAffiliatePromotionCode({
        stripe: createStripePromotionMock(),
        supabaseAdmin: createAffiliateStore(),
        affiliate: { ...affiliateBase, status: "onboarding" },
        couponId,
      }),
    /not eligible/,
  );
  await assert.rejects(
    () =>
      ensureAffiliatePromotionCode({
        stripe: createStripePromotionMock(),
        supabaseAdmin: createAffiliateStore(),
        affiliate: affiliateBase,
        couponId: null,
      }),
    /Missing affiliate coupon configuration/,
  );
});

test("paused affiliates deactivate an existing promotion code without deleting it", async () => {
  const stripe = createStripePromotionMock();
  await syncAffiliatePromotionCodeState({
    stripe,
    supabaseAdmin: createAffiliateStore(),
    affiliate: {
      ...affiliateBase,
      status: "paused",
      stripe_promotion_code_id: "promo_existing",
    },
    previousStatus: "active",
  });
  assert.deepEqual(stripe.calls.update, [
    { id: "promo_existing", params: { active: false } },
  ]);
  assert.equal(stripe.calls.create.length, 0);
});

test("ordinary checkout allows promotion codes and referral checkout pre-applies one", () => {
  const base = {
    mode: "subscription",
    metadata: { supabase_user_id: "user_1" },
  };
  const ordinary = applyAffiliateCheckoutMode(base, null);
  assert.equal(ordinary.allow_promotion_codes, true);
  assert.equal(ordinary.discounts, undefined);
  assert.equal(ordinary.metadata.affiliate_id, undefined);

  const referral = applyAffiliateCheckoutMode(base, {
    affiliateId: "aff_ra420",
    code: "RA420",
    promotionCodeId: "promo_ra420",
  });
  assert.equal(referral.allow_promotion_codes, undefined);
  assert.deepEqual(referral.discounts, [{ promotion_code: "promo_ra420" }]);
  assert.equal(referral.metadata.affiliate_ref_code, "RA420");
  assert.equal(referral.metadata.affiliate_id, "aff_ra420");
  assert.equal(referral.metadata.affiliate_promotion_code_id, "promo_ra420");
});

test("checkout referral resolution ignores invalid, inactive, and self-referral codes", async () => {
  const stripe = createStripePromotionMock();
  const supabaseAdmin = createAffiliateStore();
  assert.equal(
    await resolveCheckoutAffiliateReferral({
      stripe,
      supabaseAdmin,
      user: { id: "customer_1" },
      affiliateCode: "no",
    }),
    null,
  );
  assert.equal(
    await resolveCheckoutAffiliateReferral({
      stripe,
      supabaseAdmin,
      user: { id: "customer_1" },
      affiliateCode: "MISSING1",
    }),
    null,
  );

  const inactiveStore = createAffiliateStore({
    ...affiliateBase,
    status: "paused",
  });
  assert.equal(
    await resolveCheckoutAffiliateReferral({
      stripe,
      supabaseAdmin: inactiveStore,
      user: { id: "customer_1" },
      affiliateCode: "RA420",
    }),
    null,
  );

  const selfStore = createAffiliateStore({
    ...affiliateBase,
    stripe_promotion_code_id: "promo_existing",
  });
  assert.equal(
    await resolveCheckoutAffiliateReferral({
      stripe,
      supabaseAdmin: selfStore,
      user: { id: "aff_user_1" },
      affiliateCode: "RA420",
    }),
    null,
  );
});

test("checkout referral resolution ensures and returns the promotion code", async () => {
  const supabaseAdmin = createAffiliateStore({
    ...affiliateBase,
    stripe_promotion_code_id: "promo_existing",
  });
  const referral = await resolveCheckoutAffiliateReferral({
    stripe: createStripePromotionMock(),
    supabaseAdmin,
    user: { id: "customer_1" },
    affiliateCode: " ra420 ",
  });
  assert.deepEqual(referral, {
    affiliateId: "aff_ra420",
    code: "RA420",
    promotionCodeId: "promo_existing",
  });
});

test("checkout and invoice promotion lookups expand Stripe objects when needed", async () => {
  const stripe = {
    checkout: {
      sessions: {
        async retrieve(id, params) {
          assert.equal(id, "cs_123");
          assert.ok(params.expand.includes("discounts.promotion_code"));
          return {
            id,
            discounts: [{ promotion_code: "promo_from_session" }],
            subscription: "sub_123",
          };
        },
      },
    },
    invoices: {
      async retrieve() {
        throw new Error("should not retrieve invoice when promo is present");
      },
    },
    subscriptions: {
      async retrieve(id) {
        assert.equal(id, "sub_invoice");
        return {
          id,
          discount: { promotion_code: "promo_from_subscription" },
        };
      },
    },
  };

  assert.deepEqual(
    await retrieveCheckoutPromotionCodeIds(stripe, {
      id: "cs_123",
      discounts: [],
    }),
    ["promo_from_session"],
  );
  assert.deepEqual(
    await retrieveInvoicePromotionCodeIds(stripe, {
      id: "in_123",
      subscription: "sub_invoice",
      discounts: [],
    }),
    ["promo_from_subscription"],
  );
});

test("attribution records from a mapped promotion and ignores marketing coupons", async () => {
  const rpcCalls = [];
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, "affiliates");
      return {
        select() {
          return {
            eq(field, value) {
              return {
                async maybeSingle() {
                  if (value === "promo_ra420") {
                    return { data: { ...affiliateBase, stripe_promotion_code_id: "promo_ra420" }, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return {
        data: {
          id: "attr_1",
          affiliate_id: "aff_ra420",
          existing: false,
        },
        error: null,
      };
    },
  };

  const ignored = await recordAffiliateAttributionFromPromotion({
    supabaseAdmin,
    subscriberUserId: "customer_1",
    promotionCodeIds: ["promo_welcome"],
    source: "checkout",
  });
  assert.equal(ignored.reason, "no_mapped_affiliate");
  assert.equal(rpcCalls.length, 0);

  const created = await recordAffiliateAttributionFromPromotion({
    supabaseAdmin,
    subscriberUserId: "customer_1",
    promotionCodeIds: ["promo_ra420"],
    source: "checkout",
  });
  assert.equal(created.recorded, true);
  assert.equal(rpcCalls[0].name, "create_affiliate_attribution");
  assert.equal(rpcCalls[0].args.p_code, "RA420");
});

test("self-referrals and existing attributions never create a second ledger row", async () => {
  const supabaseAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      ...affiliateBase,
                      stripe_promotion_code_id: "promo_ra420",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc() {
      return {
        data: null,
        error: { message: "AFFILIATE_ATTRIBUTION_ALREADY_EXISTS" },
      };
    },
  };

  const self = await recordAffiliateAttributionFromPromotion({
    supabaseAdmin: {
      ...supabaseAdmin,
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        ...affiliateBase,
                        stripe_promotion_code_id: "promo_ra420",
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
    subscriberUserId: "aff_user_1",
    promotionCodeIds: ["promo_ra420"],
  });
  assert.equal(self.reason, "self_referral");
  assert.equal(self.recorded, false);

  const duplicate = await recordAffiliateAttributionFromPromotion({
    supabaseAdmin,
    subscriberUserId: "customer_1",
    promotionCodeIds: ["promo_ra420"],
  });
  assert.equal(duplicate.reason, "already_exists");
  assert.equal(duplicate.recorded, false);
});

test("invoice recovery creates a missing attribution then leaves existing ones alone", async () => {
  let attributionExists = true;
  const supabaseAdmin = {
    from(table) {
      if (table === "affiliate_attributions") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return {
                          data: attributionExists ? { id: "attr_1" } : null,
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      ...affiliateBase,
                      stripe_promotion_code_id: "promo_ra420",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc() {
      return { data: { id: "attr_2", existing: false }, error: null };
    },
  };

  const existing = await recoverAffiliateAttributionFromInvoice({
    stripe: {},
    supabaseAdmin,
    invoice: { discount: { promotion_code: "promo_ra420" } },
    userId: "customer_1",
  });
  assert.equal(existing.reason, "already_exists");

  attributionExists = false;
  const recovered = await recoverAffiliateAttributionFromInvoice({
    stripe: {},
    supabaseAdmin,
    invoice: { discount: { promotion_code: "promo_ra420" } },
    userId: "customer_1",
  });
  assert.equal(recovered.recorded, true);
});
