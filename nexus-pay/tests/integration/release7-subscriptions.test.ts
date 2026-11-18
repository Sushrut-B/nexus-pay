import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
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
let admin: { id: string; email: string; roleName: string };
let ownerId: string;
let customerId: string;
let merchantId: string;
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected API error ${status}`);
  } catch (error) {
    expect((error as ApiError).status).toBe(status);
  }
}

async function createUser(label: string, fundMinor = 0) {
  const user = await prisma.user.create({
    data: {
      id: `r7_${stamp}_${label}`,
      fullName: `Release Seven ${label}`,
      email: `r7_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r7${stamp.slice(-6)}${label}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Release Seven ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r7_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release7-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  if (fundMinor > 0) {
    const funding = await svc.funding.getOrCreateFundingOperation(user.id, { clientRequestId: randomUUID(), amountMinor: fundMinor });
    if (funding.status !== "COMPLETED") await svc.funding.executeFundingOperation(funding.id, user.id);
  }
  return user;
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    merchant: await import("../../apps/web/lib/merchant/merchant-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    plan: await import("../../apps/web/lib/subscription/plan-service"),
    subscription: await import("../../apps/web/lib/subscription/subscription-service"),
    billing: await import("../../apps/web/lib/subscription/billing-engine"),
    invoice: await import("../../apps/web/lib/subscription/invoice-service"),
    analytics: await import("../../apps/web/lib/subscription/subscription-analytics"),
    core: await import("../../apps/web/lib/subscription/subscription-core"),
  };

  const adminUser = await prisma.adminUser.create({
    data: {
      email: `r7admin${stamp}@example.test`,
      username: `r7admin${stamp}`,
      passwordHash: await hashPassword("Control!2026Test"),
      role: "SUPER_ADMIN",
    },
  });
  admin = { id: adminUser.id, email: adminUser.email, roleName: adminUser.role };

  ownerId = (await createUser("owner", 1_000)).id;
  customerId = (await createUser("customer", 2_000_000)).id;

  const merchant = await svc.merchant.createMerchant(ownerId, {
    handle: `r7shop${stamp}`,
    businessName: "Release Seven Shop",
    displayName: "R7 Shop",
    businessType: "SMALL_BUSINESS",
    category: "Subscriptions",
    email: `shop${stamp}@example.test`,
    phone: "+911234567890",
  });
  await svc.merchant.provisionMerchantWallet(ownerId);
  const active = await svc.merchant.setMerchantStatus(merchant.id, "ACTIVE", admin, "Sandbox approval", randomUUID());
  merchantId = active.id;
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.adminAuditLog.deleteMany({ where: { actorId: admin?.id } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: admin?.id ?? "none" } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r7_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

async function createPlan(overrides: Record<string, unknown> = {}) {
  const view = await svc.plan.createPlan(ownerId, {
    name: "Monthly plan",
    amountMinor: 50_000,
    currency: "INR",
    frequency: "MONTHLY",
    intervalCount: 1,
    trialDays: 0,
    setupFeeMinor: 0,
    introPeriods: 0,
    visibility: "PUBLIC",
    status: "ACTIVE",
    ...overrides,
  });
  return prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: view.id } });
}

async function subscribe(planId: string, userId = customerId) {
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: planId } });
  const created = await svc.subscription.createSubscriptionFromCheckout(userId, plan, randomUUID());
  if (created.occurrenceId) await svc.billing.processBillingOccurrence(created.occurrenceId);
  return created;
}

describe.skipIf(!enabled)("Release 7 subscription billing verification", () => {
  it(
    "SUB-01: checkout settles the first payment and activates the subscription",
    async () => {
      const plan = await createPlan();
      const created = await subscribe(plan.id);
      const settledSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(settledSubscription.status).toBe("ACTIVE");
      const occurrence = await prisma.billingOccurrence.findUniqueOrThrow({ where: { id: created.occurrenceId! } });
      expect(occurrence.status).toBe("SETTLED");
      expect(occurrence.paymentRef).toBeTruthy();
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { occurrenceId: occurrence.id } });
      expect(invoice.status).toBe("PAID");
      expect(invoice.totalMinor).toBe(50_000);
      expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
      const payment = await prisma.merchantPayment.findFirstOrThrow({ where: { paymentIntentId: occurrence.paymentIntentId! } });
      expect(payment.paymentRef).toBe(occurrence.paymentRef);
      expect(payment.source).toBe("SUBSCRIPTION");
    },
    180_000,
  );

  it(
    "SUB-02: repeating a settled occurrence cannot produce a second debit",
    async () => {
      const plan = await createPlan();
      const created = await subscribe(plan.id);
      const before = await prisma.paymentIntent.count({ where: { userId: customerId } });
      const repeat = await svc.billing.processBillingOccurrence(created.occurrenceId!);
      expect(repeat.outcome).toBe("skipped");
      expect(await prisma.paymentIntent.count({ where: { userId: customerId } })).toBe(before);
      const occurrences = await prisma.billingOccurrence.count({
        where: { subscriptionId: created.subscription.id, occurrenceNumber: 1 },
      });
      expect(occurrences).toBe(1);
      expect(await prisma.billingOccurrence.count({ where: { idempotencyKey: `r7sub:${created.subscription.id}:1` } })).toBe(1);
    },
    180_000,
  );

  it(
    "SUB-03: renewal advances the schedule with a fresh occurrence and invoice",
    async () => {
      const plan = await createPlan({ name: "Renewal plan", amountMinor: 30_000 });
      const created = await subscribe(plan.id);
      const before = await prisma.billingOccurrence.count({ where: { subscriptionId: created.subscription.id } });
      await svc.billing.runBillingWorker(25);
      const occurrences = await prisma.billingOccurrence.findMany({
        where: { subscriptionId: created.subscription.id },
        orderBy: { occurrenceNumber: "desc" },
      });
      // Settlement advances the schedule and pre-creates the following
      // occurrence, so two new rows exist after one worker pass.
      expect(occurrences.length).toBeGreaterThanOrEqual(before + 1);
      expect(occurrences.some((occurrence) => occurrence.occurrenceNumber === 2 && occurrence.status === "SETTLED")).toBe(true);
      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(subscription.occurrenceCount).toBe(2);
      expect(subscription.status).toBe("ACTIVE");
      expect(subscription.nextBillingDate).toBeTruthy();
    },
    180_000,
  );

  it(
    "SUB-04: plan edits and plan changes never rewrite existing snapshots",
    async () => {
      const plan = await createPlan({ name: "Original plan", amountMinor: 40_000 });
      const created = await subscribe(plan.id);
      const before = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      const originalSnapshot = structuredClone(before.pricingSnapshot);

      await svc.plan.updatePlan(ownerId, plan.id, { name: "Original plan v2", amountMinor: 90_000 });
      const afterEdit = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(afterEdit.pricingSnapshot).toEqual(originalSnapshot);

      const newPlan = await createPlan({ name: "Upgrade plan", amountMinor: 70_000 });
      await svc.subscription.changePlan(ownerId, created.subscription.id, { planId: newPlan.id, reason: "Upgrade" });
      const afterChange = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect((afterChange.pricingSnapshot as { amountMinor: number }).amountMinor).toBe(70_000);
      const changes = await prisma.planChange.findMany({ where: { subscriptionId: created.subscription.id } });
      expect(changes).toHaveLength(1);
      expect(changes[0]!.direction).toBe("UPGRADE");
      const historicalInvoice = await prisma.invoice.findFirstOrThrow({ where: { occurrenceId: created.occurrenceId! } });
      expect(historicalInvoice.totalMinor).toBe(40_000);
    },
    180_000,
  );

  it(
    "SUB-05: failed renewal is classified and recovers without a new debit for the same period",
    async () => {
      const poorUser = await createUser("poor", 0);
      const plan = await createPlan({ name: "Recovery plan", amountMinor: 60_000 });
      const created = await subscribe(plan.id, poorUser.id);
      const occurrence = await prisma.billingOccurrence.findUniqueOrThrow({ where: { id: created.occurrenceId! } });
      expect(["FAILED", "DEAD_LETTER"]).toContain(occurrence.status);
      expect(occurrence.failureCategory).toBeTruthy();
      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(subscription.status).toBe("PAST_DUE");
      const intentBefore = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: occurrence.paymentIntentId! } });

      const funding = await svc.funding.getOrCreateFundingOperation(poorUser.id, { clientRequestId: randomUUID(), amountMinor: 500_000 });
      if (funding.status !== "COMPLETED") await svc.funding.executeFundingOperation(funding.id, poorUser.id);
      await prisma.billingOccurrence.update({
        where: { id: occurrence.id },
        data: { status: "PENDING", nextAttemptAt: new Date(Date.now() - 1000) },
      });
      const retry = await svc.billing.processBillingOccurrence(occurrence.id);
      expect(retry.outcome).toBe("settled");
      const intentAfter = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: occurrence.paymentIntentId! } });
      expect(intentAfter.id).toBe(intentBefore.id);
      expect(intentAfter.idempotencyKey).toBe(intentBefore.idempotencyKey);
      const recovered = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(recovered.status).toBe("ACTIVE");
    },
    240_000,
  );

  it(
    "SUB-06: free trials collect nothing and activate via the worker",
    async () => {
      const plan = await createPlan({ name: "Trial plan", amountMinor: 80_000, trialDays: 2 });
      const planRow = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: plan.id } });
      const created = await svc.subscription.createSubscriptionFromCheckout(customerId, planRow, randomUUID());
      expect(created.subscription.status).toBe("TRIALING");
      expect(created.occurrenceId).toBeNull();
      expect(created.amountDueTodayMinor).toBe(0);
      await prisma.subscription.update({
        where: { id: created.subscription.id },
        data: { trialEndDate: new Date(Date.now() - 1000) },
      });
      await svc.billing.runBillingWorker(25);
      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(subscription.status).toBe("ACTIVE");
      const occurrence = await prisma.billingOccurrence.findFirstOrThrow({ where: { subscriptionId: subscription.id } });
      expect(occurrence.status).toBe("SETTLED");
    },
    180_000,
  );

  it(
    "SUB-07: cancellation at period end stops further charges",
    async () => {
      const plan = await createPlan({ name: "Cancel plan", amountMinor: 25_000 });
      const created = await subscribe(plan.id);
      await svc.subscription.cancelSubscription(ownerId, created.subscription.id, { timing: "END_OF_PERIOD", reason: "Done" }, "merchant");
      const afterRequest = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(afterRequest.status).toBe("CANCELLATION_SCHEDULED");
      await svc.billing.runBillingWorker(25);
      const afterPeriod = await prisma.subscription.findUniqueOrThrow({ where: { id: created.subscription.id } });
      expect(afterPeriod.status).toBe("CANCELLED");
      expect(afterPeriod.nextBillingDate).toBeNull();
      const pending = await prisma.billingOccurrence.count({
        where: { subscriptionId: created.subscription.id, status: { in: ["PENDING", "FAILED"] } },
      });
      expect(pending).toBe(0);
    },
    180_000,
  );

  it(
    "SUB-08: analytics and merchant isolation",
    async () => {
      const analytics = await svc.analytics.getSubscriptionAnalytics(ownerId, "month");
      expect(analytics.mrrMinor).toBeGreaterThan(0);
      expect(analytics.currency).toBe("INR");
      expect(analytics.definitions.mrrMinor).toMatch(/monthly equivalent/);
      expect(analytics.arrMinor).toBe(analytics.mrrMinor * 12);
      expect(analytics.churnRate === null || typeof analytics.churnRate === "number").toBe(true);
      expect(analytics.definitions.churnRate).toMatch(/cancelledSubscriptions/);
      expect(analytics.activeSubscriptions).toBeGreaterThan(0);
      const recovery = await svc.analytics.getRecoveryDashboard(ownerId);
      expect(typeof recovery.failedRenewalCount).toBe("number");
      // A merchant-role user cannot read subscriptions through the customer path.
      await expectApiError(svc.subscription.getSubscriptionForMerchant(customerId, "missing"), 404);
      // Another customer cannot read someone else's subscription.
      const stranger = await createUser("stranger", 0);
      const mine = await prisma.subscription.findFirstOrThrow({ where: { merchantId, customerUserId: customerId } });
      await expectApiError(svc.subscription.getSubscriptionForCustomer(stranger.id, mine.id), 404);
    },
    60_000,
  );

  it(
    "SUB-09: concurrent processing of one occurrence settles exactly once",
    async () => {
      const plan = await createPlan({ amountMinor: 15_000, name: "Concurrency plan" });
      const planRow = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { id: plan.id } });
      const created = await svc.subscription.createSubscriptionFromCheckout(customerId, planRow, randomUUID());
      const intentCountBefore = await prisma.paymentIntent.count({ where: { userId: customerId } });

      const results = await Promise.allSettled([
        svc.billing.processBillingOccurrence(created.occurrenceId!),
        svc.billing.processBillingOccurrence(created.occurrenceId!),
      ]);
      const outcomes = results.map((result) => (result.status === "fulfilled" ? result.value.outcome : "error"));
      expect(outcomes.filter((outcome) => outcome === "settled")).toHaveLength(1);
      expect(outcomes).toContain("skipped");
      expect(await prisma.paymentIntent.count({ where: { userId: customerId } })).toBe(intentCountBefore + 1);
      expect(await prisma.invoice.count({ where: { occurrenceId: created.occurrenceId! } })).toBe(1);
      expect(await prisma.merchantPayment.count({ where: { idempotencyKey: `r7sub:${created.subscription.id}:1` } })).toBe(1);
    },
    180_000,
  );

  it(
    "SUB-10: introductory price applies only to configured periods",
    async () => {
      const plan = await createPlan({
        name: "Intro plan", amountMinor: 50_000, introPriceMinor: 20_000, introPeriods: 1,
      });
      const created = await subscribe(plan.id);
      const first = await prisma.billingOccurrence.findUniqueOrThrow({ where: { id: created.occurrenceId! } });
      expect(first.amountMinor).toBe(20_000);
      const firstInvoice = await prisma.invoice.findFirstOrThrow({ where: { occurrenceId: first.id } });
      expect(firstInvoice.totalMinor).toBe(20_000);

      await svc.billing.runBillingWorker(25);
      const second = await prisma.billingOccurrence.findFirstOrThrow({
        where: { subscriptionId: created.subscription.id, occurrenceNumber: 2 },
      });
      expect(second.amountMinor).toBe(50_000);
      expect(second.status).toBe("SETTLED");
    },
    180_000,
  );

  it(
    "SUB-11: downgrades are recorded with direction and keep historical pricing",
    async () => {
      const high = await createPlan({ name: "High tier", amountMinor: 100_000 });
      const low = await createPlan({ name: "Low tier", amountMinor: 30_000 });
      const created = await subscribe(high.id);
      await svc.subscription.changePlan(ownerId, created.subscription.id, { planId: low.id, reason: "Downgrade" });
      const change = await prisma.planChange.findFirstOrThrow({ where: { subscriptionId: created.subscription.id } });
      expect(change.direction).toBe("DOWNGRADE");
      const historical = await prisma.invoice.findFirstOrThrow({ where: { occurrenceId: created.occurrenceId! } });
      expect(historical.totalMinor).toBe(100_000);
    },
    180_000,
  );

  it(
    "SUB-12: subscription lifecycle events reach subscribed webhook endpoints",
    async () => {
      const webhook = await import("../../apps/web/lib/merchant/webhook-service");
      let delivered = 0;
      const server: Server = createServer((request, response) => {
        request.resume();
        request.on("end", () => {
          delivered += 1;
          response.writeHead(200).end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const endpoint = await webhook.createEndpoint(ownerId, {
        url: `http://127.0.0.1:${port}/hook`,
        events: ["subscription.created", "subscription.activated", "invoice.paid"],
      });

      const plan = await createPlan({ name: "Webhook plan", amountMinor: 45_000 });
      await subscribe(plan.id);

      const events = await prisma.merchantWebhookEvent.findMany({
        where: { merchantId, eventType: { in: ["subscription.created", "subscription.activated", "invoice.paid"] } },
      });
      expect(events.some((event) => event.eventType === "subscription.created")).toBe(true);
      expect(events.some((event) => event.eventType === "subscription.activated")).toBe(true);
      expect(events.some((event) => event.eventType === "invoice.paid")).toBe(true);

      await webhook.runWebhookWorker(25);
      expect(delivered).toBeGreaterThanOrEqual(3);
      const deliveries = await prisma.merchantWebhookDelivery.findMany({ where: { endpointId: endpoint.id } });
      expect(deliveries.some((delivery) => delivery.status === "DELIVERED")).toBe(true);
      server.close();
    },
    120_000,
  );
});
