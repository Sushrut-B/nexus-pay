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
let merchantOwnerId: string;
let otherUserId: string;
let merchantId: string;
const createdUserIds: string[] = [];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected API error ${status}`);
  } catch (error) {
    expect((error as ApiError).status).toBe(status);
  }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r6_${stamp}_${label}`,
      fullName: `Merchant Test ${label}`,
      email: `r6_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r6${stamp.slice(-6)}${label}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Merchant Test ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r6_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  const raftline = createRaftlineClient();
  await raftline.ensureAccount({ accountId, currency: "INR", metadata: { source: "release6-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return { user, accountId };
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    merchant: await import("../../apps/web/lib/merchant/merchant-service"),
    order: await import("../../apps/web/lib/merchant/order-service"),
    link: await import("../../apps/web/lib/merchant/payment-link-service"),
    payment: await import("../../apps/web/lib/merchant/payment-service"),
    refund: await import("../../apps/web/lib/merchant/refund-service"),
    analytics: await import("../../apps/web/lib/merchant/analytics-service"),
    webhook: await import("../../apps/web/lib/merchant/webhook-service"),
    apiKey: await import("../../apps/web/lib/merchant/api-key-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    recipients: await import("../../apps/web/lib/payments/recipient-service"),
    payments: await import("../../apps/web/lib/payments/payment-service"),
  };

  const superAdmin = await prisma.adminUser.create({
    data: {
      email: `r6admin${stamp}@example.test`,
      username: `r6admin${stamp}`,
      passwordHash: await hashPassword("Control!2026Test"),
      role: "SUPER_ADMIN",
    },
  });
  admin = { id: superAdmin.id, email: superAdmin.email, roleName: superAdmin.role };

  const owner = await createUser("owner");
  merchantOwnerId = owner.user.id;
  const other = await createUser("buyer");
  otherUserId = other.user.id;

  const fund = await svc.funding.getOrCreateFundingOperation(otherUserId, {
    clientRequestId: randomUUID(),
    amountMinor: 1_000_000,
  });
  if (fund.status !== "COMPLETED") await svc.funding.executeFundingOperation(fund.id, otherUserId);
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.merchantWebhookDelivery.deleteMany({ where: { endpoint: { merchantId: { in: [] } } } }).catch(() => undefined);
  await prisma.adminAuditLog.deleteMany({ where: { actorId: admin?.id } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: admin?.id ?? "none" } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r6_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

async function buildActiveMerchant() {
  if (merchantId) {
    const existing = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    if (existing.status === "ACTIVE") return svc.merchant.toMerchantView(existing);
    return svc.merchant.setMerchantStatus(merchantId, "ACTIVE", admin, "Sandbox approval", randomUUID());
  }
  const merchant = await svc.merchant.createMerchant(merchantOwnerId, {
    handle: `r6shop${stamp}`,
    businessName: "Release Six Shop",
    displayName: "R6 Shop",
    businessType: "SMALL_BUSINESS",
    category: "Retail",
    email: `shop${stamp}@example.test`,
    phone: "+911234567890",
  });
  const provisioned = await svc.merchant.provisionMerchantWallet(merchantOwnerId);
  expect(provisioned.status).toBe("DRAFT");
  const active = await svc.merchant.setMerchantStatus(merchant.id, "ACTIVE", admin, "Sandbox approval", randomUUID());
  merchantId = active.id;
  return active;
}

async function payMerchant(amountMinor: number, source: "PAYMENT_LINK" | "QR" = "PAYMENT_LINK", orderId?: string, linkId?: string) {
  return svc.payment.processMerchantPayment({
    customerUserId: otherUserId,
    merchantId,
    amountMinor,
    clientRequestId: randomUUID(),
    description: "Release 6 integration payment",
    source,
    orderId,
    linkId,
  });
}

describe.skipIf(!enabled)("Release 6 merchant ecosystem verification", () => {
  it(
    "MER-01: onboarding, idempotent wallet provisioning and approval",
    async () => {
      const merchant = await buildActiveMerchant();
      expect(merchant.status).toBe("ACTIVE");
      const again = await svc.merchant.provisionMerchantWallet(merchantOwnerId);
      expect(again.id).toBe(merchant.id);
      const events = await prisma.merchantApprovalEvent.findMany({ where: { merchantId: merchant.id } });
      expect(events.some((event) => event.toStatus === "ACTIVE")).toBe(true);
    },
    120_000,
  );

  it(
    "MER-02: order totals use integer paise and links are created",
    async () => {
      await buildActiveMerchant();
      const order = await svc.order.createOrder(merchantOwnerId, {
        title: "Test order",
        items: [{ title: "Item", quantity: 2, unitPriceMinor: 15_000 }],
        taxMinor: 1_000,
        discountMinor: 500,
      });
      expect(order.subtotalMinor).toBe(30_000);
      expect(order.totalMinor).toBe(30_500);
      const link = await svc.link.createPaymentLink(merchantOwnerId, { title: "Pay order", amountMinor: order.totalMinor });
      expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(link.status).toBe("ACTIVE");
    },
    60_000,
  );

  it(
    "MER-03: checkout settlement marks order paid and emits outbox event",
    async () => {
      await buildActiveMerchant();
      const order = await svc.order.createOrder(merchantOwnerId, { title: "Checkout order", items: [{ title: "Item", quantity: 1, unitPriceMinor: 20_000 }] });
      const payment = await payMerchant(20_000, "PAYMENT_LINK", order.id);
      expect(payment.status).toBe("SETTLED");
      const updated = await svc.order.getOrderForUser(merchantOwnerId, order.id);
      expect(updated.status).toBe("PAID");
      const events = await prisma.merchantWebhookEvent.findMany({ where: { merchantId, eventType: "payment.succeeded" } });
      expect(events.length).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    "MER-04: repeated checkout confirmation cannot duplicate a debit",
    async () => {
      await buildActiveMerchant();
      const before = await prisma.paymentIntent.count({ where: { userId: otherUserId } });
      const clientRequestId = randomUUID();
      const first = await svc.payment.processMerchantPayment({
        customerUserId: otherUserId, merchantId, amountMinor: 10_000,
        clientRequestId, description: "Duplicate test", source: "PAYMENT_LINK",
      });
      const intentCountAfterFirst = await prisma.paymentIntent.count({ where: { userId: otherUserId } });
      const second = await svc.payment.processMerchantPayment({
        customerUserId: otherUserId, merchantId, amountMinor: 10_000,
        clientRequestId, description: "Duplicate test", source: "PAYMENT_LINK",
      });
      expect(second.id).toBe(first.id);
      expect(await prisma.paymentIntent.count({ where: { userId: otherUserId } })).toBe(intentCountAfterFirst);
      expect(intentCountAfterFirst).toBeGreaterThan(before);
      expect(await prisma.merchantPayment.count({ where: { merchantId, paymentRef: first.paymentRef } })).toBe(1);
    },
    180_000,
  );

  it(
    "MER-05: static QR payment records the same reference",
    async () => {
      await buildActiveMerchant();
      const payment = await payMerchant(5_000, "QR");
      expect(payment.source).toBe("QR");
      expect(payment.status).toBe("SETTLED");
      const record = await prisma.merchantPayment.findUniqueOrThrow({ where: { id: payment.id } });
      const receipt = await createRaftlineClient().getTransaction(record.paymentRef);
      expect(receipt?.status.toUpperCase()).toBe("SETTLED");
    },
    180_000,
  );

  it(
    "MER-06: refund request validates limits and review moves no money",
    async () => {
      await buildActiveMerchant();
      const payment = await payMerchant(12_000, "PAYMENT_LINK");
      await expectApiError(
        svc.refund.createRefundRequest(merchantOwnerId, { paymentId: payment.id, amountMinor: 20_000, reason: "Over refund", type: "PARTIAL" }),
        409,
      );
      const refund = await svc.refund.createRefundRequest(merchantOwnerId, { paymentId: payment.id, amountMinor: 4_000, reason: "Customer changed mind", type: "PARTIAL" });
      expect(refund.status).toBe("REQUESTED");
      const reviewed = await svc.refund.reviewRefund(refund.id, { decision: "APPROVE", note: "Approved for sandbox review" }, admin);
      expect(reviewed.status).toBe("APPROVED");
      expect(reviewed.executionNote).toMatch(/no money was moved/i);
      const updatedPayment = await prisma.merchantPayment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updatedPayment.refundedMinor).toBe(0);
    },
    180_000,
  );

  it(
    "MER-07: webhook signatures verify and outbox worker delivers",
    async () => {
      await buildActiveMerchant();
      const received: Array<{ signature: string; timestamp: string; body: string }> = [];
      const server: Server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => { body += chunk.toString(); });
        request.on("end", () => {
          received.push({
            signature: String(request.headers["x-nexus-signature"] ?? ""),
            timestamp: String(request.headers["x-nexus-timestamp"] ?? ""),
            body,
          });
          response.writeHead(200).end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const endpoint = await svc.webhook.createEndpoint(merchantOwnerId, {
        url: `http://127.0.0.1:${port}/hook`,
        events: ["payment.succeeded"],
      });
      const eventId = await svc.webhook.createWebhookEvent(merchantId, "payment.succeeded", { test: true });
      const result = await svc.webhook.runWebhookWorker(25);
      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(svc.webhook.verifySignature(endpoint.signingSecret, received[0]!.timestamp, received[0]!.body, received[0]!.signature)).toBe(true);
      const deliveries = await svc.webhook.listDeliveries(merchantOwnerId, endpoint.id);
      expect(deliveries.some((delivery) => delivery.eventId === eventId && delivery.status === "DELIVERED")).toBe(true);
      server.close();
    },
    120_000,
  );

  it(
    "MER-08: API keys enforce scopes and merchant isolation",
    async () => {
      await buildActiveMerchant();
      const key = await svc.apiKey.createApiKey(merchantOwnerId, { name: "Test key", scopes: ["orders:read"] });
      expect(key.secret).toMatch(/^npk_/);
      const valid = await svc.apiKey.authenticateApiKey(key.secret, "orders:read");
      expect(valid?.merchantId).toBe(merchantId);
      expect(await svc.apiKey.authenticateApiKey(key.secret, "refunds:create")).toBeNull();
      expect(await svc.apiKey.authenticateApiKey("npk_invalid", "orders:read")).toBeNull();
      await expectApiError(svc.merchant.requireActiveMerchant(otherUserId), 404);
      await expectApiError(svc.link.getPaymentLinkForUser(otherUserId, (await svc.link.listPaymentLinks(merchantOwnerId))[0]!.id), 404);
      await svc.apiKey.revokeApiKey(merchantOwnerId, key.id);
      expect(await svc.apiKey.authenticateApiKey(key.secret, "orders:read")).toBeNull();
    },
    60_000,
  );

  it(
    "MER-09: analytics derive only from confirmed records",
    async () => {
      await buildActiveMerchant();
      const analytics = await svc.analytics.getMerchantAnalytics(merchantOwnerId, "month");
      expect(analytics.grossVolumeMinor).toBeGreaterThan(0);
      expect(analytics.successfulPayments).toBeGreaterThan(0);
      expect(analytics.netVolumeMinor).toBeLessThanOrEqual(analytics.grossVolumeMinor);
      expect(analytics.currency).toBe("INR");
      const customers = await svc.analytics.listMerchantCustomers(merchantOwnerId);
      expect(customers.length).toBeGreaterThan(0);
      expect(customers.every((customer) => !customer.emailMasked || customer.emailMasked.includes("••••"))).toBe(true);
    },
    60_000,
  );
});
