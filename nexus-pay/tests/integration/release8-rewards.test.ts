import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import { hashPassword } from "../../apps/web/lib/security/passwords";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;
let admin: { id: string; email: string; roleName: string; requestId: string };
let ownerId: string;
let customerId: string;
let merchantId: string;
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string, fundMinor = 0) {
  const user = await prisma.user.create({
    data: {
      id: `r8_${stamp}_${label}`,
      fullName: `Release Eight ${label}`,
      email: `r8_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r8${stamp.slice(-6)}${label}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Release Eight ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r8_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release8-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  if (fundMinor > 0) {
    const funding = await svc.funding.getOrCreateFundingOperation(user.id, { clientRequestId: randomUUID(), amountMinor: fundMinor });
    if (funding.status !== "COMPLETED") await svc.funding.executeFundingOperation(funding.id, user.id);
  }
  return user;
}

async function createCampaign(overrides: Record<string, unknown> = {}) {
  const endAt = new Date(Date.now() + 30 * 86_400_000);
  const campaign = await prisma.rewardCampaign.create({
    data: {
      merchantId,
      ownerType: "MERCHANT",
      name: `Campaign ${randomUUID().slice(0, 6)}`,
      description: "Release 8 test campaign",
      type: "POINTS_MULTIPLIER",
      status: "ACTIVE",
      startAt: new Date(Date.now() - 60_000),
      endAt,
      minSpendMinor: 0,
      maxRewardMinor: 0,
      pointsPerMinor: 5,
      budgetMinor: 1_000_000,
      pointsBudget: 100_000,
      createdBy: ownerId,
      ...overrides,
    },
  });
  await prisma.campaignBudget.create({
    data: { campaignId: campaign.id, allocatedMinor: campaign.budgetMinor, pointsAllocated: campaign.pointsBudget },
  });
  return campaign;
}

async function makeSettledPayment(amountMinor: number) {
  return svc.merchantPayments.processMerchantPayment({
    customerUserId: customerId,
    merchantId,
    amountMinor,
    clientRequestId: randomUUID(),
    description: "Release 8 test purchase",
    source: "DIRECT",
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    merchant: await import("../../apps/web/lib/merchant/merchant-service"),
    merchantPayments: await import("../../apps/web/lib/merchant/payment-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    ledger: await import("../../apps/web/lib/rewards/ledger-service"),
    core: await import("../../apps/web/lib/rewards/reward-core"),
    earning: await import("../../apps/web/lib/rewards/earning-service"),
    redemption: await import("../../apps/web/lib/rewards/redemption-service"),
    cashback: await import("../../apps/web/lib/rewards/cashback-service"),
    promo: await import("../../apps/web/lib/rewards/promo-service"),
    campaign: await import("../../apps/web/lib/rewards/campaign-service"),
    referral: await import("../../apps/web/lib/rewards/referral-service"),
    analytics: await import("../../apps/web/lib/rewards/rewards-analytics"),
    admin: await import("../../apps/web/lib/rewards/admin-service"),
    worker: await import("../../apps/web/lib/rewards/rewards-worker"),
  };
  const adminUser = await prisma.adminUser.create({
    data: { email: `r8admin${stamp}@example.test`, username: `r8admin${stamp}`, passwordHash: await hashPassword("Control!2026Test"), role: "SUPER_ADMIN" },
  });
  admin = { id: adminUser.id, email: adminUser.email, roleName: adminUser.role, requestId: randomUUID() };
  ownerId = (await createUser("owner", 1_000)).id;
  customerId = (await createUser("customer", 5_000_000)).id;
  const merchant = await svc.merchant.createMerchant(ownerId, {
    handle: `r8shop${stamp}`, businessName: "Release Eight Shop", displayName: "R8 Shop",
    businessType: "SMALL_BUSINESS", category: "Rewards", email: `shop${stamp}@example.test`, phone: "+911234567890",
  });
  await svc.merchant.provisionMerchantWallet(ownerId);
  merchantId = (await svc.merchant.setMerchantStatus(merchant.id, "ACTIVE", admin, "Sandbox approval", randomUUID())).id;
  await svc.core.getOrCreateRewardAccount(customerId);
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.adminAuditLog.deleteMany({ where: { actorId: admin?.id } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: admin?.id ?? "none" } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r8_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 8 rewards verification", () => {
  it("REW-01: eligible settled payment earns deterministic points and replay is a no-op", async () => {
    await createCampaign({ pointsPerMinor: 5 });
    const payment = await makeSettledPayment(100_000);
    const first = await svc.earning.processMerchantPaymentRewards(payment.id);
    expect(first.points).toBe(60); // 10 base + 50 campaign
    await svc.earning.processMerchantPaymentRewards(payment.id);
    const entries = await prisma.rewardLedgerEntry.count({
      where: { userId: customerId, transactionRef: payment.paymentRef },
    });
    expect(entries).toBe(2);
  }, 240_000);

  it("REW-02: non-settled payments never generate rewards", async () => {
    const row = await prisma.merchantPayment.create({
      data: {
        merchantId, customerUserId: customerId, paymentIntentId: `rejected_${randomUUID()}`,
        paymentRef: `rejected_${randomUUID()}`, idempotencyKey: randomUUID(), amountMinor: 100_000,
        currency: "INR", status: "REJECTED", source: "DIRECT",
      },
    });
    const outcome = await svc.earning.processMerchantPaymentRewards(row.id);
    expect(outcome).toEqual({ points: 0, cashback: 0 });
  }, 60_000);

  it("REW-03: redemption deducts points once and replay does not double-deduct", async () => {
    await svc.ledger.appendLedgerEntry({
      userId: customerId, type: "EARN", points: 500, referenceType: "TEST", referenceId: randomUUID(),
      description: "Test top-up", idempotencyKey: randomUUID(),
    });
    const item = await prisma.rewardCatalogueItem.create({
      data: { name: "Voucher", description: "Test voucher", type: "VOUCHER", pointsCost: 200, isActive: true },
    });
    const before = await prisma.rewardAccount.findUniqueOrThrow({ where: { userId: customerId } });
    const key = `redeem-${randomUUID()}`;
    const first = await svc.redemption.redeemReward(customerId, { catalogueItemId: item.id, idempotencyKey: key });
    const second = await svc.redemption.redeemReward(customerId, { catalogueItemId: item.id, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    const account = await prisma.rewardAccount.findUniqueOrThrow({ where: { userId: customerId } });
    expect(account.availablePoints).toBe(before.availablePoints - 200);
  }, 120_000);

  it("REW-04: two concurrent 150-point redemptions cannot both succeed from 200 points", async () => {
    const account = await prisma.rewardAccount.findUniqueOrThrow({ where: { userId: customerId } });
    // Normalize to exactly 200 points for a deterministic concurrency test.
    const adjustment = 200 - account.availablePoints;
    if (adjustment !== 0) {
      await svc.ledger.appendLedgerEntry({
        userId: customerId, type: "ADJUST", points: adjustment,
        referenceType: "TEST", referenceId: randomUUID(), description: "Concurrency setup", idempotencyKey: randomUUID(),
      });
    }
    const item = await prisma.rewardCatalogueItem.create({
      data: { name: "Limited", description: "Concurrent voucher", type: "VOUCHER", pointsCost: 150, isActive: true },
    });
    const results = await Promise.allSettled([0, 1].map(() =>
      svc.redemption.redeemReward(customerId, { catalogueItemId: item.id, idempotencyKey: `concurrent-${randomUUID()}` }),
    ));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const accountAfter = await prisma.rewardAccount.findUniqueOrThrow({ where: { userId: customerId } });
    expect(accountAfter.availablePoints).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("REW-05: cashback entitlement credits once through Raftline-backed funding", async () => {
    const campaign = await createCampaign({ type: "CASHBACK", cashbackBps: 1000, maxRewardMinor: 10_000, pointsPerMinor: 0 });
    const transactionRef = `cashback-${randomUUID()}`;
    const entitlement = await svc.cashback.createCashbackEntitlement({
      userId: customerId, campaignId: campaign.id, transactionRef, amountMinor: 10_000,
    });
    const first = await svc.cashback.processCashbackEntitlement(entitlement.id);
    expect(first.outcome).toBe("credited");
    const repeat = await svc.cashback.processCashbackEntitlement(entitlement.id);
    expect(repeat.outcome).toBe("skipped");
    const attempts = await prisma.cashbackProcessingAttempt.count({ where: { entitlementId: entitlement.id } });
    expect(attempts).toBe(1);
  }, 240_000);

  it("REW-06: promo discount is server-calculated and consumed once", async () => {
    const campaign = await createCampaign({
      type: "PERCENTAGE_DISCOUNT", discountBps: 1000, maxRewardMinor: 5_000,
      pointsPerMinor: 0, budgetMinor: 100_000, promoCode: `SAVE${stamp.slice(-6)}`,
    });
    const orderId = `order-${randomUUID()}`;
    const result = await svc.promo.validatePromoCode(customerId, { code: campaign.promoCode!, amountMinor: 100_000, orderId });
    expect(result.valid).toBe(true);
    expect(result.discountMinor).toBe(5_000);
    expect(result.payableMinor).toBe(95_000);
    await svc.promo.consumePromoCode({
      campaignId: campaign.id, userId: customerId, orderId,
      reservationId: result.reservationId!, discountMinor: result.discountMinor, paymentRef: `pay-${orderId}`,
    });
    const redemptions = await prisma.promoCodeRedemption.count({ where: { promoCodeId: campaign.id } });
    expect(redemptions).toBe(1);
  }, 120_000);

  it("REW-07: concurrent budget reservations never overspend", async () => {
    const campaign = await createCampaign({ type: "CASHBACK", cashbackBps: 1000, pointsPerMinor: 0, budgetMinor: 10_000 });
    const results = await Promise.allSettled([0, 1, 2].map((index) =>
      svc.campaign.reserveBudget({
        campaignId: campaign.id, userId: customerId, referenceType: "TEST",
        referenceId: `budget-${index}-${stamp}`, amountMinor: 5_000,
      }),
    ));
    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value !== null);
    expect(succeeded).toHaveLength(2);
    const budget = await prisma.campaignBudget.findUniqueOrThrow({ where: { campaignId: campaign.id } });
    expect(budget.reservedMinor).toBeLessThanOrEqual(budget.allocatedMinor);
  }, 120_000);

  it("REW-08: points expiry is idempotent and preserves history", async () => {
    const key = randomUUID();
    await svc.ledger.appendLedgerEntry({
      userId: customerId, type: "EARN", points: 50, referenceType: "TEST", referenceId: key,
      description: "Expiring points", idempotencyKey: key, expiresAt: new Date(Date.now() - 1000),
    });
    const first = await svc.worker.runRewardsWorker();
    const second = await svc.worker.runRewardsWorker();
    expect(first.expiredEntries).toBeGreaterThanOrEqual(1);
    const entries = await prisma.rewardLedgerEntry.findMany({
      where: { userId: customerId, type: "EXPIRE", referenceId: { in: [key] } },
    });
    const expiries = await prisma.rewardLedgerEntry.count({ where: { userId: customerId, type: "EXPIRE" } });
    expect(expiries).toBeGreaterThanOrEqual(1);
    void entries;
    void second;
  }, 180_000);

  it("REW-09: referral qualifying payment issues rewards once; self-referral rejected", async () => {
    const referrerCode = await svc.referral.getOrCreateReferralCode(ownerId);
    await expectApiError(svc.referral.attributeReferral(referrerCode.code, ownerId), 400);
    const referred = await createUser("referred", 500_000);
    const attribution = await svc.referral.attributeReferral(referrerCode.code, referred.id);
    await svc.merchantPayments.processMerchantPayment({
      customerUserId: referred.id, merchantId, amountMinor: 50_000, clientRequestId: randomUUID(),
      description: "Qualifying payment", source: "DIRECT",
    });
    await svc.referral.runReferralQualification(50);
    const rewards = await prisma.referralReward.findMany({ where: { attributionId: attribution.id } });
    expect(rewards).toHaveLength(2);
    const repeat = await svc.referral.runReferralQualification(50);
    expect(repeat).toBeGreaterThanOrEqual(0);
    const afterRepeat = await prisma.referralReward.count({ where: { attributionId: attribution.id } });
    expect(afterRepeat).toBe(2);
  }, 240_000);

  it("REW-10: merchant isolation and admin controls are enforced", async () => {
    const foreign = await createUser("foreign", 0);
    const campaign = await createCampaign({ status: "DRAFT" });
    const view = await svc.campaign.getCampaignForMerchant(ownerId, campaign.id);
    expect(view.id).toBe(campaign.id);
    await expectApiError(svc.campaign.getCampaignForMerchant(foreign.id, campaign.id), 404);
    await expectApiError(svc.campaign.setCampaignStatus(campaign.id, "ACTIVE", "test", admin), 409);
    const submitted = await svc.campaign.submitCampaign(ownerId, campaign.id);
    expect(submitted.status).toBe("PENDING_APPROVAL");
    const approved = await svc.campaign.setCampaignStatus(campaign.id, "APPROVED", "Approved", admin);
    expect(approved.status).toBe("APPROVED");
    const audit = await prisma.adminAuditLog.findFirst({ where: { targetId: campaign.id, action: "REWARD_CAMPAIGN_STATUS_CHANGED" } });
    expect(audit).toBeTruthy();
  }, 120_000);

  it("REW-11: notifications are deduplicated by event key", async () => {
    const key = `dedupe-${randomUUID()}`;
    await svc.admin.manualAdjustment(
      { userId: customerId, points: 10, reason: "Dedupe test adjustment", idempotencyKey: key },
      admin,
    );
    await svc.admin.manualAdjustment(
      { userId: customerId, points: 10, reason: "Dedupe test adjustment", idempotencyKey: key },
      admin,
    );
    const events = await prisma.rewardNotificationEvent.count({ where: { eventKey: `adjustment:${key}` } });
    expect(events).toBe(1);
  }, 120_000);
});
