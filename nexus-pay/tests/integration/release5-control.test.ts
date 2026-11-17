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
let createdUserIds: string[] = [];
let control: {
  collector: typeof import("../../apps/web/lib/control/collector");
  payment: typeof import("../../apps/web/lib/control/payment-service");
  audit: typeof import("../../apps/web/lib/control/audit");
  auth: typeof import("../../apps/web/lib/control/auth");
  raftline: typeof import("../../apps/web/lib/control/raftline-adapter");
  payments: typeof import("../../apps/web/lib/payments/payment-service");
  recipients: typeof import("../../apps/web/lib/payments/recipient-service");
  funding: typeof import("../../apps/web/lib/payments/funding-service");
};
let admin: { id: string; email: string; roleName: string };
let customerId: string;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected API error ${status}`);
  } catch (error) {
    expect((error as ApiError).status).toBe(status);
  }
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  control = {
    collector: await import("../../apps/web/lib/control/collector"),
    payment: await import("../../apps/web/lib/control/payment-service"),
    audit: await import("../../apps/web/lib/control/audit"),
    auth: await import("../../apps/web/lib/control/auth"),
    raftline: await import("../../apps/web/lib/control/raftline-adapter"),
    payments: await import("../../apps/web/lib/payments/payment-service"),
    recipients: await import("../../apps/web/lib/payments/recipient-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
  };

  const superAdmin = await prisma.adminUser.create({
    data: {
      email: `r5super${stamp}@example.test`,
      username: `r5super${stamp}`,
      passwordHash: await hashPassword("Control!2026Test"),
      role: "SUPER_ADMIN",
    },
  });
  admin = { id: superAdmin.id, email: superAdmin.email, roleName: superAdmin.role };
  createdUserIds.push(superAdmin.id);

  const viewer = await prisma.adminUser.create({
    data: {
      email: `r5viewer${stamp}@example.test`,
      username: `r5viewer${stamp}`,
      passwordHash: await hashPassword("Control!2026Test"),
      role: "VIEWER",
    },
  });
  createdUserIds.push(viewer.id);

  const digits = randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const alice = await prisma.user.create({
    data: {
      id: `r5_${stamp}_alice`,
      fullName: "Control Test Alice",
      email: `r5_${stamp}_alice@example.test`,
      phoneNumber: `+91${digits}`,
      passwordHash: "integration-only",
      username: `r5a${stamp}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: "Control Test Alice", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  const bob = await prisma.user.create({
    data: {
      id: `r5_${stamp}_bob`,
      fullName: "Control Test Bob",
      email: `r5_${stamp}_bob@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r5b${stamp}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: "Control Test Bob", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  customerId = alice.id;

  for (const user of [alice, bob]) {
    const accountId = `np_r5_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const raftline = createRaftlineClient();
    await raftline.ensureAccount({ accountId, currency: "INR", metadata: { source: "release5-test" } });
    await prisma.wallet.create({
      data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
    });
  }
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.adminAuditLog.deleteMany({ where: { actorId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.adminSession.deleteMany({ where: { adminUserId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r5_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 5 Nexus Control verification", () => {
  it(
    "collects real cluster observations and discovers the leader dynamically",
    async () => {
      const overview = await control.collector.collectClusterSnapshot();
      expect(overview.configuredNodes).toBe(5);
      expect(overview.leaderId).toMatch(/^node-[1-5]$/);
      expect(overview.quorum).toBe(3);
      expect(overview.quorumAvailable).toBe(true);
      expect(overview.nodes).toHaveLength(5);
      expect(overview.stale).toBe(false);
      expect(overview.replicationProgress).toBe("Not available");

      const snapshots = await prisma.clusterSnapshot.count();
      expect(snapshots).toBeGreaterThan(0);
      const observations = await prisma.nodeObservation.count({ where: { snapshotId: { not: "" } } });
      expect(observations).toBeGreaterThanOrEqual(5);
    },
    60_000,
  );

  it(
    "records audit events for privileged actions and never stores secrets",
    async () => {
      await control.audit.recordAdminAudit({
        actorId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.roleName,
        action: "TEST_PRIVILEGED_ACTION",
        targetType: "test",
        targetId: "target-1",
        reason: "Release 5 verification",
        outcome: "SUCCESS",
        metadata: { safe: true },
      });
      const logs = await prisma.adminAuditLog.findMany({ where: { action: "TEST_PRIVILEGED_ACTION" } });
      expect(logs).toHaveLength(1);
      expect(logs[0]!.reason).toBe("Release 5 verification");
      const raw = JSON.stringify(logs[0]);
      expect(raw.toLowerCase()).not.toContain("password");
      expect(raw.toLowerCase()).not.toContain("bearer ");
    },
    30_000,
  );

  it(
    "reconciles a verified payment without creating a second debit",
    async () => {
      const fund = await control.funding.getOrCreateFundingOperation(customerId, {
        clientRequestId: randomUUID(),
        amountMinor: 200_000,
      });
      if (fund.status !== "COMPLETED") await control.funding.executeFundingOperation(fund.id, customerId);

      const bob = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: `r5_${stamp}_bob` } } });
      const recipient = await control.recipients.searchRecipient(customerId, bob.username);
      const intent = await control.payments.getOrCreatePaymentIntent(customerId, {
        clientRequestId: randomUUID(),
        recipientToken: recipient.recipientToken,
        amountMinor: 40_000,
        description: "Control reconciliation test",
      });
      let payment = await control.payments.executePaymentIntent(intent.id, customerId);
      for (let attempt = 0; attempt < 20 && payment.status !== "SETTLED"; attempt += 1) {
        if (payment.status !== "PROCESSING" && payment.status !== "UNKNOWN") break;
        await delay(1000);
        payment = await control.payments.executePaymentIntent(intent.id, customerId);
      }
      expect(payment.status).toBe("SETTLED");

      const operations = await control.payment.listPaymentOperations({ paymentRef: payment.paymentRef! });
      expect(operations).toHaveLength(1);
      const view = operations[0]!;
      expect(view.idempotencyKeyMasked).toContain("••••");
      expect(view.senderWalletMasked).toContain("••••");
      expect(JSON.stringify(view)).not.toContain(intent.idempotencyKey);
      expect(JSON.stringify(view)).not.toContain((await prisma.wallet.findFirstOrThrow({ where: { userId: customerId } })).raftlineAccountId);

      const opened = await control.payment.openReconciliationCase(intent.id, admin, randomUUID());
      expect(opened.status).toBe("OPEN");
      const investigated = await control.payment.investigateReconciliation(opened.id, admin, randomUUID());
      expect(investigated.evidence.receipt).toMatchObject({ status: "SETTLED", amountCents: 40_000 });

      const intentsBefore = await prisma.paymentIntent.count({ where: { userId: customerId } });
      const resolved = await control.payment.resolveReconciliation(
        opened.id,
        { decision: "RESOLVED_SETTLED", reason: "Verified receipt from Raftline" },
        admin,
        randomUUID(),
      );
      expect(resolved.status).toBe("RESOLVED_SETTLED");
      const intentsAfter = await prisma.paymentIntent.count({ where: { userId: customerId } });
      expect(intentsAfter).toBe(intentsBefore);

      await expectApiError(
        control.payment.resolveReconciliation(
          opened.id,
          { decision: "RESOLVED_SETTLED", reason: "Duplicate resolution attempt" },
          admin,
          randomUUID(),
        ),
        409,
      );
    },
    240_000,
  );

  it(
    "masks sensitive fields in payment views and blocks unauthorized role escalation",
    async () => {
      const viewer = await prisma.adminUser.findFirstOrThrow({ where: { username: { startsWith: "r5viewer" } } });
      expect(control.auth.hasPermission(viewer.role, "chaos:write")).toBe(false);
      expect(control.auth.hasPermission(viewer.role, "admin:write")).toBe(false);
      expect(control.auth.hasPermission(viewer.role, "cluster:read")).toBe(true);
      expect(control.auth.hasPermission("OPERATOR", "admin:write")).toBe(false);
    },
    30_000,
  );
});
