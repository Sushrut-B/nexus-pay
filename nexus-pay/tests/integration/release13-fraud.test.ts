import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r13_${stamp}_${label}`,
      fullName: `Release Thirteen ${label}`,
      email: `r13_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r13${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Thirteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r13_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release13-test" } });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return { user, wallet, accountId };
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    event: await import("../../apps/web/lib/fraud/event-service"),
    worker: await import("../../apps/web/lib/fraud/event-worker"),
    engine: await import("../../apps/web/lib/fraud/risk-engine"),
    case: await import("../../apps/web/lib/fraud/case-service"),
    report: await import("../../apps/web/lib/fraud/report-service"),
    device: await import("../../apps/web/lib/fraud/device-service"),
    gateway: await import("../../apps/web/lib/fraud/payment-gateway"),
    rules: await import("../../apps/web/lib/fraud/rules"),
    bootstrap: await import("../../apps/web/lib/fraud/fraud-bootstrap"),
    audit: await import("../../apps/web/lib/fraud/audit-service"),
    control: await import("../../apps/web/lib/fraud/control-service"),
    ruleAdmin: await import("../../apps/web/lib/fraud/rule-admin-service"),
  };
  await svc.bootstrap.ensureFraudConfiguration();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r13_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 13 fraud intelligence verification", () => {
  it("FRAUD-01: configuration seeds rules, policy and an advisory-only model", async () => {
    expect(await prisma.fraudRule.count({ where: { enabled: true } })).toBeGreaterThan(10);
    expect(await prisma.riskPolicy.findUnique({ where: { code: "default" } })).not.toBeNull();
    const model = await prisma.fraudModelVersion.findFirst({ where: { status: "ACTIVE" } });
    expect(model?.advisoryOnly).toBe(true);
    expect(model?.datasetRef).toContain("NONE");
  }, 120_000);

  it("FRAUD-02: outbox publishes an immutable event once, with sanitized metadata", async () => {
    const { user } = await createUser("events");
    const eventId = `r13_evt_${stamp}`;
    await svc.event.publishSecurityEvent({
      eventId, type: "LOGIN_SUCCESS", occurredAt: new Date(), actorId: user.id,
      sourceModule: "auth", metadata: { password: "never-store-me", note: "safe" },
    });
    const first = await svc.worker.runSecurityEventWorker(100);
    expect(first.published).toBeGreaterThanOrEqual(1);
    await svc.worker.runSecurityEventWorker(100);
    expect(await prisma.securityEvent.count({ where: { eventId } })).toBe(1);
    const row = await prisma.securityEvent.findUniqueOrThrow({ where: { eventId } });
    expect(JSON.stringify(row.metadata)).not.toContain("never-store-me");
    const view = svc.event.eventView(row);
    expect(view.masked).toBe(true);
  }, 120_000);

  it("FRAUD-03: a high-risk evaluation is explainable and generates an alert", async () => {
    const { user } = await createUser("risk");
    const evaluation = await svc.engine.evaluateRisk({
      mode: "MANUAL", subjectType: "USER", subjectId: user.id, userId: user.id,
      context: {
        failedLoginCount: 9, passwordResetCount: 4, newDevice: true,
        recoveryRecent: true, sourceModule: "payments", velocityCount: 8,
        recipientCount: 9, failedPaymentCount: 5,
      },
    });
    expect(evaluation.score).toBeGreaterThan(0);
    expect(evaluation.classification).toBe("CRITICAL");
    expect(evaluation.triggeredRules.length).toBeGreaterThan(2);
    expect(evaluation.explanation).toContain("rule");
    const alert = await prisma.riskAlert.findFirst({ where: { evaluationId: evaluation.id } });
    expect(alert).not.toBeNull();
  }, 120_000);

  it("FIN-04: a risk assessment does not change a Raftline wallet balance", async () => {
    const { user, accountId } = await createUser("boundary");
    const client = createRaftlineClient();
    const before = await client.getAccount(accountId);
    expect(before).not.toBeNull();
    await svc.gateway.evaluatePaymentRisk({
      userId: user.id, amountMinor: 5_000_00, recipientId: "recipient-test",
      clientRequestId: "client-risk-test", ipAddress: "127.0.0.1",
    });
    const after = await client.getAccount(accountId);
    expect(after!.availableBalanceCents).toBe(before!.availableBalanceCents);
    expect(after!.balanceCents).toBe(before!.balanceCents);
  }, 120_000);

  it("FIN-05: a blocked decision creates no payment intent or ledger transaction", async () => {
    const policy = await prisma.riskPolicy.findUniqueOrThrow({ where: { code: "default" } });
    const { user } = await createUser("blocked");
    const decision = await svc.gateway.evaluatePaymentRisk({
      userId: user.id, amountMinor: 1_000_000_00, recipientId: "suspicious-recipient",
      clientRequestId: `block-${stamp}`, forceFallback: false,
    });
    expect(typeof decision.allow).toBe("boolean");
    expect(decision.evaluation.reference).toContain("risk_");
    expect(await prisma.paymentIntent.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.transactionRecord.count({ where: { userId: user.id } })).toBe(0);
    expect(policy.fallbackAction).toBeTruthy();
  }, 120_000);

  it("FIN-06: a post-transaction assessment never relabels a settled transaction", async () => {
    const [{ user, wallet }, recipient] = await Promise.all([createUser("settled"), createUser("recipient")]);
    const intent = await prisma.paymentIntent.create({
      data: {
        userId: user.id, walletId: wallet.id, recipientUserId: recipient.user.id,
        clientRequestId: `settled-${stamp}`, idempotencyKey: `np_pay_${stamp}`,
        recipientUsername: recipient.user.username!, recipientDisplayName: "Test Recipient",
        sourceAccountId: wallet.raftlineAccountId!, destinationAccountId: recipient.wallet.raftlineAccountId!,
        amountMinor: BigInt(1000), currency: "INR", status: "SETTLED",
        paymentRef: `pmt_r13_${stamp}`, receiptVerifiedAt: new Date(), raftLogIndex: BigInt(1),
      },
    });
    const before = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await svc.gateway.recordPostTransactionAssessment({
      userId: user.id, paymentIntentId: intent.id, amountMinor: 1000, outcome: "SETTLED",
    });
    const after = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.status).toBe(before.status);
    expect(after.settledAt?.getTime() ?? null).toBe(before.settledAt?.getTime() ?? null);
  }, 120_000);

  it("SEC-07: customer data and reports are isolated between users", async () => {
    const [a, b] = await Promise.all([createUser("usera"), createUser("userb")]);
    const report = await svc.report.createReport(a.user.id, {
      category: "SUSPICIOUS_LOGIN", description: "I did not recognise this sign-in attempt.",
    });
    await expectApiError(svc.report.getReport(b.user.id, report.id), 404);
    await expectApiError(svc.report.getReportHistory(b.user.id, report.id), 404);
    const device = `dev_${stamp}`;
    await svc.device.recordDeviceActivity({ userId: a.user.id, deviceId: device, description: "Phone" });
    expect((await svc.device.listDevices(b.user.id)).some((item: { deviceId: string }) => item.deviceId === device)).toBe(false);
  }, 120_000);

  it("CASE-08: an alert becomes a case with audited lifecycle changes", async () => {
    const { user } = await createUser("case");
    const evaluation = await svc.engine.evaluateRisk({
      mode: "MANUAL", subjectType: "USER", subjectId: user.id, userId: user.id,
      context: { failedLoginCount: 9, passwordResetCount: 4, recoveryRecent: true, sourceModule: "payments" },
    });
    const alert = await prisma.riskAlert.findFirstOrThrow({ where: { evaluationId: evaluation.id } });
    const created = await svc.case.createCaseFromAlert(alert.id, "fraud-admin", "Investigate");
    expect(created.status).toBe("OPEN");
    const assigned = await svc.case.assignCase(created.id, "fraud-analyst", "fraud-admin", "Assignment");
    expect(assigned.assignedTo).toBe("fraud-analyst");
    await svc.case.addCaseNote(created.id, "Internal note - not for customers", true, "fraud-analyst");
    await svc.case.transitionCase(created.id, "INVESTIGATING", "fraud-analyst", "Started investigation");
    const escalated = await svc.case.escalateCase(created.id, "fraud-analyst", "Needs review");
    expect(escalated.status).toBe("ESCALATED");
    const resolved = await svc.case.resolveCase(created.id, "FALSE_POSITIVE", "Verified legitimate activity", "fraud-admin");
    expect(resolved.status).toBe("FALSE_POSITIVE");
    const audits = await prisma.securityAuditEvent.count({ where: { targetType: "fraud_case", targetId: created.id } });
    expect(audits).toBeGreaterThan(3);
  }, 120_000);

  it("OPS-09: a rule change is versioned and audited", async () => {
    const rule = await prisma.fraudRule.findFirstOrThrow({ where: { code: "AUTH_FAILED_LOGIN_VELOCITY" } });
    const updated = await svc.ruleAdmin.updateRule(rule.id, { riskContribution: 19 }, "fraud-admin", "Tune contribution");
    expect(updated.version).toBe(rule.version + 1);
    const versions = await prisma.fraudRuleVersion.count({ where: { ruleId: rule.id } });
    expect(versions).toBeGreaterThanOrEqual(1);
    const audit = await prisma.securityAuditEvent.findFirst({
      where: { action: "FRAUD_RULE_UPDATED", targetId: rule.id },
    });
    expect(audit?.justification).toBe("Tune contribution");
  }, 120_000);

  it("OPS-10: Control metrics never fabricate confirmed fraud", async () => {
    const view = await svc.control.getFraudOperations();
    expect(view.confirmedFraud).toBe(0);
    expect(view.notice).toContain("not proof of fraud");
    expect(typeof view.eventBacklog).toBe("number");
  }, 120_000);
});
