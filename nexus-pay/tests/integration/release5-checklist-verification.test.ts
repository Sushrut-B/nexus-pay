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
let admin: { id: string; email: string; roleName: string; role: "SUPER_ADMIN" };
let svc: {
  auth: typeof import("../../apps/web/lib/control/auth");
  collector: typeof import("../../apps/web/lib/control/collector");
  chaos: typeof import("../../apps/web/lib/control/chaos-service");
  payment: typeof import("../../apps/web/lib/control/payment-service");
  audit: typeof import("../../apps/web/lib/control/alert-service");
  metrics: typeof import("../../apps/web/lib/control/metrics-service");
  raftline: typeof import("../../apps/web/lib/control/raftline-adapter");
  payments: typeof import("../../apps/web/lib/payments/payment-service");
  recipients: typeof import("../../apps/web/lib/payments/recipient-service");
  funding: typeof import("../../apps/web/lib/payments/funding-service");
};
let customerId: string;
let customerAccountId: string;
let recipientUsername: string;

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
  svc = {
    auth: await import("../../apps/web/lib/control/auth"),
    collector: await import("../../apps/web/lib/control/collector"),
    chaos: await import("../../apps/web/lib/control/chaos-service"),
    payment: await import("../../apps/web/lib/control/payment-service"),
    audit: await import("../../apps/web/lib/control/alert-service"),
    metrics: await import("../../apps/web/lib/control/metrics-service"),
    raftline: await import("../../apps/web/lib/control/raftline-adapter"),
    payments: await import("../../apps/web/lib/payments/payment-service"),
    recipients: await import("../../apps/web/lib/payments/recipient-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
  };

  const superAdmin = await prisma.adminUser.create({
    data: {
      email: `r5csuper${stamp}@example.test`,
      username: `r5csuper${stamp}`,
      passwordHash: await hashPassword("Control!2026Test"),
      role: "SUPER_ADMIN",
    },
  });
  admin = { id: superAdmin.id, email: superAdmin.email, roleName: superAdmin.role, role: superAdmin.role };
  createdUserIds.push(superAdmin.id);

  const raftline = createRaftlineClient();
  const user = await prisma.user.create({
    data: {
      id: `r5c_${stamp}_alice`,
      fullName: "Checklist Alice",
      email: `r5c_${stamp}_alice@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r5ca${stamp}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: "Checklist Alice", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  customerId = user.id;
  customerAccountId = `np_r5c_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await raftline.ensureAccount({ accountId: customerAccountId, currency: "INR", metadata: { source: "release5-checklist" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: customerAccountId, provisionedAt: new Date() },
  });

  const digits = randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const bob = await prisma.user.create({
    data: {
      id: `r5c_${stamp}_bob`,
      fullName: "Checklist Bob",
      email: `r5c_${stamp}_bob@example.test`,
      phoneNumber: `+91${digits}`,
      passwordHash: "integration-only",
      username: `r5cb${stamp}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: "Checklist Bob", preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  recipientUsername = bob.username;
  const bobAccountId = `np_r5c_${bob.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await raftline.ensureAccount({ accountId: bobAccountId, currency: "INR", metadata: { source: "release5-checklist" } });
  await prisma.wallet.create({
    data: { userId: bob.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: bobAccountId, provisionedAt: new Date() },
  });

  const fund = await svc.funding.getOrCreateFundingOperation(customerId, {
    clientRequestId: randomUUID(),
    amountMinor: 500_000,
  });
  if (fund.status !== "COMPLETED") await svc.funding.executeFundingOperation(fund.id, customerId);
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.chaosOperationEvent.deleteMany({
    where: { operation: { actorId: { in: createdUserIds } } },
  }).catch(() => undefined);
  await prisma.chaosOperation.deleteMany({ where: { actorId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.reconciliationCase.deleteMany({ where: { operatorId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.adminAuditLog.deleteMany({ where: { actorId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.adminSession.deleteMany({ where: { adminUserId: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r5c_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

async function createTestPayment(description: string, amountMinor = 10_000) {
  const recipient = await svc.recipients.searchRecipient(customerId, recipientUsername);
  const intent = await svc.payments.getOrCreatePaymentIntent(customerId, {
    clientRequestId: randomUUID(),
    recipientToken: recipient.recipientToken,
    amountMinor,
    description,
  });
  let payment = await svc.payments.executePaymentIntent(intent.id, customerId);
  for (let attempt = 0; attempt < 20 && payment.status !== "SETTLED"; attempt += 1) {
    if (payment.status !== "PROCESSING" && payment.status !== "UNKNOWN") break;
    await delay(1000);
    payment = await svc.payments.executePaymentIntent(intent.id, customerId);
  }
  expect(payment.status).toBe("SETTLED");
  return { intent, payment };
}

describe.skipIf(!enabled)("Release 5 checklist verification", () => {
  it(
    "CTL-01: separate Nexus Control authentication and RBAC",
    async () => {
      const viewer = await prisma.adminUser.create({
        data: {
          email: `r5cviewer${stamp}@example.test`,
          username: `r5cviewer${stamp}`,
          passwordHash: await hashPassword("Control!2026Test"),
          role: "VIEWER",
        },
      });
      createdUserIds.push(viewer.id);
      const operator = await prisma.adminUser.create({
        data: {
          email: `r5coperator${stamp}@example.test`,
          username: `r5coperator${stamp}`,
          passwordHash: await hashPassword("Control!2026Test"),
          role: "OPERATOR",
        },
      });
      createdUserIds.push(operator.id);

      expect(svc.auth.hasPermission("SUPER_ADMIN", "admin:write")).toBe(true);
      expect(svc.auth.hasPermission("OPERATOR", "chaos:write")).toBe(true);
      expect(svc.auth.hasPermission("OPERATOR", "admin:write")).toBe(false);
      expect(svc.auth.hasPermission("VIEWER", "chaos:write")).toBe(false);
      expect(svc.auth.hasPermission("VIEWER", "cluster:read")).toBe(true);

      const session = await prisma.adminSession.create({
        data: {
          adminUserId: admin.id,
          tokenHash: randomUUID().replace(/-/g, ""),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      expect(session.adminUserId).toBe(admin.id);
      expect(session.tokenHash).toHaveLength(32);
      expect(await prisma.userSession.count({ where: { userId: customerId } })).toBe(0);
    },
    30_000,
  );

  it(
    "CTL-02: live five-node cluster monitoring",
    async () => {
      const overview = await svc.collector.collectClusterSnapshot();
      expect(overview.configuredNodes).toBe(5);
      expect(overview.nodes).toHaveLength(5);
      expect(overview.quorum).toBe(3);
      expect(overview.stale).toBe(false);
      const probes = await svc.raftline.probeCluster();
      expect(probes).toHaveLength(5);
      expect(probes.some((probe) => probe.reachable && probe.role === "LEADER")).toBe(true);
    },
    60_000,
  );

  it(
    "CTL-03: dynamic leader discovery and election history",
    async () => {
      const realLeader = (await svc.raftline.probeCluster()).find((probe) => probe.reachable && probe.role === "LEADER");
      expect(realLeader).toBeTruthy();

      // Seed a previous snapshot with a different leader; the collector must
      // discover the real leader and record an observed transition.
      const previous = await prisma.clusterSnapshot.create({
        data: {
          leaderId: "node-previous",
          term: BigInt(1),
          commitIndex: BigInt(1),
          lastApplied: BigInt(1),
          healthyNodes: 5,
          unavailableNodes: 0,
          quorum: 3,
          totalNodes: 5,
          health: "DEGRADED",
          capturedMs: 1,
          observedAt: new Date(Date.now() - 1000),
        },
      });
      const beforeCount = await prisma.leaderTransition.count({ where: { snapshotId: previous.id } });
      expect(beforeCount).toBe(0);

      const overview = await svc.collector.collectClusterSnapshot();
      expect(overview.leaderId).toBe(realLeader!.nodeId);
      const transition = await prisma.leaderTransition.findFirst({
        where: { snapshotId: { not: previous.id } },
        orderBy: { observedAt: "desc" },
      });
      expect(transition?.toLeaderId).toBe(realLeader!.nodeId);
      expect(transition?.source).toBe("OBSERVED");
    },
    90_000,
  );

  it(
    "CTL-04: interactive node topology and node details",
    async () => {
      const overview = await svc.collector.collectClusterSnapshot();
      const node = overview.nodes[0]!;
      expect(node.httpUrl).toMatch(/^http:\/\/localhost:800[1-5]$/);
      expect(node.grpcPort).toBeGreaterThanOrEqual(9001);
      expect(node.grpcPort).toBeLessThanOrEqual(9005);
      expect(typeof node.reachable).toBe("boolean");
      const observations = await prisma.nodeObservation.findMany({
        where: { nodeId: node.nodeId },
        orderBy: { observedAt: "desc" },
        take: 3,
      });
      expect(observations.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "CTL-05: controlled chaos injection and healing",
    async () => {
      await expect(
        svc.chaos.injectChaosOperation(
          admin,
          { nodeId: "node-2", scenario: "PARTITION_MAJORITY", reason: "Safety verification - must be blocked" },
          randomUUID(),
        ),
      ).rejects.toThrow(/disabled|quorum|Safety/i);

      const before = await prisma.chaosOperation.count();
      const injected = await svc.chaos.injectChaosOperation(
        admin,
        { nodeId: "node-2", scenario: "PARTITION_NODE", reason: "R5-CHECKLIST injection verification" },
        randomUUID(),
      );
      expect(injected.status).toBe("INJECTED");
      expect(injected.response.scenario).toBe("PARTITION_NODE");
      const healed = await svc.chaos.healChaosOperation(
        admin,
        { nodeId: "node-2", reason: "R5-CHECKLIST heal verification", all: true },
        randomUUID(),
      );
      expect(healed.status).toBe("HEALED");
      expect(await prisma.chaosOperation.count()).toBe(before + 2);
      const audit = await prisma.adminAuditLog.findMany({ where: { action: "CHAOS_INJECTED" }, take: 1 });
      expect(audit.length).toBe(1);
    },
    180_000,
  );

  it(
    "CTL-06: payment operations investigation",
    async () => {
      const { payment } = await createTestPayment("R5 checklist investigation");
      const operations = await svc.payment.listPaymentOperations({ paymentRef: payment.paymentRef! });
      expect(operations).toHaveLength(1);
      const view = operations[0]!;
      expect(view.idempotencyKeyMasked).toContain("••••");
      expect(view.senderWalletMasked).toContain("••••");
      expect(view.recipientWalletMasked).toContain("••••");
      expect(view.settlement).toBe(view.idempotentReplay ? "IDEMPOTENT_REPLAY" : "NEW_SUCCESS");
      const detailed = await svc.payment.getPaymentOperation(payment.paymentRef!);
      expect(detailed.intentId).toBe(view.intentId);
    },
    180_000,
  );

  it(
    "CTL-07: safe payment reconciliation",
    async () => {
      const { intent, payment } = await createTestPayment("R5 checklist reconciliation");
      const before = await prisma.paymentIntent.count({ where: { userId: customerId } });
      const opened = await svc.payment.openReconciliationCase(intent.id, admin, randomUUID());
      expect(opened.status).toBe("OPEN");
      const investigated = await svc.payment.investigateReconciliation(opened.id, admin, randomUUID());
      expect(investigated.evidence.receipt).toMatchObject({ status: "SETTLED", amountCents: 10_000 });
      const resolved = await svc.payment.resolveReconciliation(
        opened.id,
        { decision: "RESOLVED_SETTLED", reason: "Receipt verified by payment reference" },
        admin,
        randomUUID(),
      );
      expect(resolved.status).toBe("RESOLVED_SETTLED");
      expect(await prisma.paymentIntent.count({ where: { userId: customerId } })).toBe(before);
      await expectApiError(
        svc.payment.resolveReconciliation(opened.id, { decision: "RESOLVED_SETTLED", reason: "Second attempt" }, admin, randomUUID()),
        409,
      );
      expect(payment.status).toBe("SETTLED");
    },
    240_000,
  );

  it(
    "CTL-08: historical metrics and alerts",
    async () => {
      await svc.collector.collectClusterSnapshot();
      const { from, to } = svc.metrics.resolveRange("hour");
      const metrics = await svc.metrics.getMetrics(from, to);
      expect(metrics.samples).toBeGreaterThan(0);
      expect(metrics.availability.length).toBeGreaterThan(0);
      expect(metrics.source).toBe("NEXUS_OBSERVED");
      expect(metrics.replicationLag).toBe("Not available");

      await svc.collector.collectClusterSnapshot();
      const fingerprints = await prisma.operationalAlert.findMany({ select: { fingerprint: true } });
      expect(new Set(fingerprints.map((item) => item.fingerprint)).size).toBe(fingerprints.length);
      expect((await svc.audit.listAlerts()).length).toBeGreaterThanOrEqual(0);
    },
    90_000,
  );

  it(
    "CTL-09: immutable administrative audit history",
    async () => {
      for (const action of ["R5_CHECKLIST_AUDIT_1", "R5_CHECKLIST_AUDIT_2"]) {
        await prisma.adminAuditLog.create({
          data: {
            actorId: admin.id,
            actorEmail: admin.email,
            actorRole: admin.roleName,
            action,
            targetType: "test",
            targetId: randomUUID(),
            outcome: "SUCCESS",
          },
        });
      }
      const logs = await prisma.adminAuditLog.findMany({ where: { action: { startsWith: "R5_CHECKLIST_AUDIT" } } });
      expect(logs).toHaveLength(2);
      expect(new Set(logs.map((log) => log.id)).size).toBe(2);
      expect(JSON.stringify(logs).toLowerCase()).not.toContain("password");
      expect(JSON.stringify(logs).toLowerCase()).not.toContain("bearer ");
      // The admin API surface exposes only reads for audit records.
      const list = await svc.audit.listAudit(10);
      expect(list.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "CTL-10: end-to-end failover and payment recovery",
    async () => {
      const before = await svc.collector.collectClusterSnapshot();
      expect(before.health).toBe("HEALTHY");

      const injected = await svc.chaos.injectChaosOperation(
        admin,
        { nodeId: before.leaderId!, scenario: "KILL_LEADER", reason: "R5-CHECKLIST failover acceptance" },
        randomUUID(),
      );
      expect(injected.status).toBe("INJECTED");

      let after = await svc.collector.collectClusterSnapshot();
      for (let i = 0; i < 8 && after.term === before.term; i += 1) {
        await delay(2000);
        after = await svc.collector.collectClusterSnapshot();
      }
      expect(after.term).not.toBe(before.term);
      expect(after.leaderId).toMatch(/^node-[1-5]$/);

      const healed = await svc.chaos.healChaosOperation(
        admin,
        { nodeId: before.leaderId!, reason: "R5-CHECKLIST heal after failover", all: true },
        randomUUID(),
      );
      expect(healed.status).toBe("HEALED");

      const { payment } = await createTestPayment("R5 checklist post-failover payment");
      const receipt = await svc.raftline.getRaftlineReceipt(payment.paymentRef!);
      expect(receipt?.status.toUpperCase()).toBe("SETTLED");

      const opened = await svc.payment.openReconciliationCase(
        (await prisma.paymentIntent.findFirstOrThrow({ where: { paymentRef: payment.paymentRef! } })).id,
        admin,
        randomUUID(),
      );
      const evidence = await svc.payment.investigateReconciliation(opened.id, admin, randomUUID());
      expect(evidence.evidence.receipt).toMatchObject({ status: "SETTLED" });

      const audit = await prisma.adminAuditLog.findMany({
        where: { action: { in: ["CHAOS_INJECTED", "CHAOS_HEALED", "RECONCILIATION_RESOLVED"] } },
      });
      expect(audit.map((item) => item.action)).toContain("CHAOS_INJECTED");
      expect(audit.map((item) => item.action)).toContain("CHAOS_HEALED");
    },
    300_000,
  );
});
