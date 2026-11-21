import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../packages/database/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      id: `r19_${stamp}_${label}`,
      fullName: `Release Nineteen ${label}`,
      email: `r19_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r19${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Nineteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  process.env.NEXUS_SUPPORT_ENABLED = "true";
  svc = {
    constants: await import("../../apps/web/lib/support/support-constants"),
    cases: await import("../../apps/web/lib/support/case-service"),
    evidence: await import("../../apps/web/lib/support/evidence-service"),
    help: await import("../../apps/web/lib/support/help-service"),
    operations: await import("../../apps/web/lib/support/support-operations"),
    worker: await import("../../apps/web/lib/support/support-worker-bootstrap"),
    controlAuth: await import("../../apps/web/lib/control/auth"),
  };
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r19_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 19 support centre verification", () => {
  it("CASE-01: creates a case with a server-verified linked record", async () => {
    const user = await createUser("link");
    const tx = await prisma.transactionRecord.create({
      data: {
        userId: user.id, kind: "P2P", direction: "SENT", status: "SUCCESSFUL", amountMinor: 50000, currency: "INR",
        paymentRef: `r19tx${stamp}`, occurredAt: new Date(),
      },
    });
    const created = await svc.cases.createCase(user.id, {
      category: "PAYMENT_STATUS_UNCLEAR", linkedType: "P2P_PAYMENT",
      linkedReference: tx.paymentRef ?? tx.id,
      description: "My payment status is still unclear after several minutes.",
      idempotencyKey: `r19-case-01-${stamp}`,
    });
    expect(created.status).toBe("OPEN");
    expect(created.linkedReference).toBe(tx.paymentRef);
    expect(created.authoritativeStatus).toBeTruthy();
    const link = await prisma.supportLinkedOperation.findFirst({ where: { caseId: created.id } });
    expect(link?.ownerVerified).toBe(true);
  }, 120_000);

  it("CASE-02: rejects a linked record owned by another user", async () => {
    const a = await createUser("link-a");
    const b = await createUser("link-b");
    const tx = await prisma.transactionRecord.create({
      data: { userId: a.id, kind: "P2P", direction: "SENT", status: "SUCCESSFUL", amountMinor: 900, currency: "INR", paymentRef: `r19other${stamp}`, occurredAt: new Date() },
    });
    await expectApiError(svc.cases.createCase(b.id, {
      category: "PAYMENT_STATUS_UNCLEAR", linkedType: "P2P_PAYMENT",
      linkedReference: tx.id, description: "Attempting to reference someone else's payment record here.",
      idempotencyKey: `r19-case-02-${stamp}`,
    }), 404);
  }, 120_000);

  it("CASE-03: retried submission never creates a duplicate case", async () => {
    const user = await createUser("dedupe");
    const input = {
      category: "OTHER" as const, linkedType: "GENERAL" as const,
      description: "A repeated support concern about my account experience today.",
      idempotencyKey: `r19-case-03-${stamp}`,
    };
    const first = await svc.cases.createCase(user.id, input);
    const second = await svc.cases.createCase(user.id, input);
    expect(first.id).toBe(second.id);
    expect(await prisma.supportCase.count({ where: { userId: user.id } })).toBe(1);
  }, 120_000);

  it("CASE-04: lifecycle, internal notes and customer-visible messaging stay separate", async () => {
    const user = await createUser("lifecycle");
    const staff = "r19-agent";
    const created = await svc.cases.createCase(user.id, {
      category: "MERCHANT_ORDER_ISSUE", linkedType: "GENERAL",
      description: "My merchant order issue requires careful support review.",
      idempotencyKey: `r19-case-04-${stamp}`,
    });
    await svc.cases.assignCase(staff, created.id, staff);
    await svc.cases.transitionStatus(staff, created.id, { status: "TRIAGED" });
    await svc.cases.transitionStatus(staff, created.id, { status: "IN_PROGRESS" });
    const noteId = await svc.cases.addInternalNote(staff, created.id, {
      body: "Internal risk signal discussed; do not disclose.", idempotencyKey: `r19-note-${stamp}`,
    });
    await svc.cases.sendStaffMessage(staff, created.id, {
      body: "We are reviewing your case and will update you.", idempotencyKey: `r19-reply-${stamp}`,
    });
    const detail = await svc.cases.getCase(user.id, created.id);
    expect(detail.messages.some((m: any) => m.id === noteId)).toBe(false);
    expect(detail.messages.every((m: any) => m.visibility === "CUSTOMER_VISIBLE")).toBe(true);
    expect(detail.status).toBe("WAITING_FOR_USER");
    await svc.cases.proposeResolution(staff, created.id, {
      summary: "Reviewed the records and proposed a resolution.", outcome: "RESOLVED",
    });
    await svc.cases.resolveCase(staff, created.id, {
      summary: "Case resolved at support level; no financial status changed.", outcome: "RESOLVED",
    });
    const reopened = await svc.cases.reopenCase(user.id, created.id);
    expect(reopened.status).toBe("REOPENED");
    const events = await prisma.supportCaseEvent.findMany({ where: { caseId: created.id } });
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["CASE_CREATED", "STATUS_CHANGED", "INTERNAL_NOTE_ADDED", "SUPPORT_REPLIED", "RESOLUTION_PROPOSED", "CASE_RESOLVED", "CASE_REOPENED"]));
  }, 120_000);

  it("CASE-05: escalation records a documented signal and raises priority with history", async () => {
    const user = await createUser("escalation");
    const created = await svc.cases.createCase(user.id, {
      category: "UNAUTHORIZED_ACTIVITY", linkedType: "GENERAL",
      description: "I see activity I do not recognise in my account.",
      idempotencyKey: `r19-case-05-${stamp}`,
    });
    expect(created.priority).toBe("HIGH");
    await svc.cases.escalateCase("r19-supervisor", created.id, {
      reason: "Specialist review required", signal: "UNAUTHORIZED_ACTIVITY",
    });
    const escalations = await prisma.supportEscalation.findMany({ where: { caseId: created.id } });
    expect(escalations).toHaveLength(1);
    expect(escalations[0].signal).toBe("UNAUTHORIZED_ACTIVITY");
    expect(await prisma.supportPriorityHistory.count({ where: { caseId: created.id } })).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("CASE-06: notifications are de-duplicated by stable event key", async () => {
    const user = await createUser("notifications");
    const created = await svc.cases.createCase(user.id, {
      category: "OTHER", linkedType: "GENERAL",
      description: "Checking that duplicate notifications are prevented for my case.",
      idempotencyKey: `r19-case-06-${stamp}`,
    });
    const before = await prisma.notification.count({ where: { userId: user.id } });
    await svc.operations.updateSupportPreferences(user.id, { caseUpdates: false });
    await svc.cases.transitionStatus("r19-agent", created.id, { status: "TRIAGED" });
    await svc.cases.transitionStatus("r19-agent", created.id, { status: "IN_PROGRESS" });
    const events = await prisma.supportNotificationEvent.findMany({ where: { caseId: created.id } });
    expect(new Set(events.map((e) => e.eventKey)).size).toBe(events.length);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(before); // preference respected
  }, 120_000);

  it("CASE-07: evidence is encrypted, signed and ownership-protected", async () => {
    const a = await createUser("evidence-a");
    const b = await createUser("evidence-b");
    const created = await svc.cases.createCase(a.id, {
      category: "DOCUMENT_STATEMENT_ISSUE", linkedType: "GENERAL",
      description: "Attaching a statement screenshot for review of my account.",
      idempotencyKey: `r19-case-07-${stamp}`,
    });
    const plaintext = "SECRET-EVIDENCE-CONTENT-" + stamp;
    const evidence = await svc.evidence.uploadEvidence(a.id, created.id, {
      bytes: Buffer.from(plaintext), fileName: "receipt.png", contentType: "image/png",
    });
    const stored = await prisma.supportMessageAttachment.findUnique({ where: { id: evidence.id } });
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(stored!.storagePath, "utf8");
    expect(raw).not.toContain(plaintext);
    await expectApiError(svc.evidence.getEvidenceLink(b.id, evidence.id), 404);
    const link = await svc.evidence.getEvidenceLink(a.id, evidence.id);
    const url = new URL(link, "http://localhost");
    const downloaded = await svc.evidence.downloadEvidence(a.id, evidence.id, url.searchParams.get("token") ?? "", url.searchParams.get("expiresAt") ?? "");
    expect(downloaded.bytes.toString()).toBe(plaintext);
    await expectApiError(svc.evidence.downloadEvidence(a.id, evidence.id, "bad", url.searchParams.get("expiresAt") ?? ""), 401);
  }, 120_000);

  it("CASE-08: support cases never modify authoritative payment status", async () => {
    const user = await createUser("no-mutation");
    const tx = await prisma.transactionRecord.create({
      data: { userId: user.id, kind: "P2P", direction: "SENT", status: "SUCCESSFUL", amountMinor: 1200, currency: "INR", paymentRef: `r19nomut${stamp}`, occurredAt: new Date() },
    });
    const created = await svc.cases.createCase(user.id, {
      category: "PAYMENT_FAILED_BALANCE_AFFECTED", linkedType: "WALLET_TRANSACTION",
      linkedReference: tx.id, description: "The payment failed but my balance looks affected.",
      idempotencyKey: `r19-case-08-${stamp}`,
    });
    await svc.cases.transitionStatus("r19-agent", created.id, { status: "TRIAGED" });
    await svc.cases.transitionStatus("r19-agent", created.id, { status: "IN_PROGRESS" });
    await svc.cases.resolveCase("r19-agent", created.id, {
      summary: "Support case resolved; authoritative transaction unchanged.", outcome: "NO_ACTION_REQUIRED",
    });
    const after = await prisma.transactionRecord.findUnique({ where: { id: tx.id } });
    expect(after?.status).toBe("SUCCESSFUL");
    expect(created.status).not.toBe(after?.status);
  }, 120_000);

  it("CASE-09: worker only accepts read-only support jobs and recovers leases", async () => {
    await expect(svc.worker.enqueueSupportJob({ kind: "EXECUTE_REFUND" })).rejects.toThrow("not an allowed");
    const job = await svc.worker.enqueueSupportJob({
      kind: "ANALYTICS_AGGREGATION", idempotencyKey: `r19-job-${stamp}`,
    });
    expect(await svc.worker.processSupportJob(job.id)).toBe("processed");
    const stored = await prisma.supportJob.findUnique({ where: { id: job.id } });
    expect(stored!.status).toBe("COMPLETED");
    await prisma.supportJob.update({
      where: { id: job.id }, data: { status: "PROCESSING", leaseUntil: new Date(Date.now() - 1000) },
    });
    await svc.worker.runSupportWorker();
    expect((await prisma.supportJob.findUnique({ where: { id: job.id } }))!.status).toBe("COMPLETED");
  }, 120_000);

  it("CASE-10: help centre categories, versioned articles and feedback work", async () => {
    const user = await createUser("help");
    const categories = await svc.help.ensureHelpCategories();
    expect(categories.length).toBeGreaterThanOrEqual(10);
    const actor = "r19-agent";
    const id = await svc.help.createArticle(actor, {
      categoryCode: "WALLET_PAYMENTS", title: `Release19 Guide ${stamp}`,
      body: "General guidance for wallet payments. This is not a provider-specific refund promise.",
      status: "DRAFT",
    });
    const version = await svc.help.publishNewVersion(actor, id, {
      title: `Release19 Guide ${stamp}`,
      body: "Reviewed guidance for wallet payments. No unsupported refund timeline is published.",
    });
    expect(version).toBe(2);
    await svc.help.recordFeedback(user.id, id, true);
    const article = await svc.help.getArticle(`release19-guide-${stamp.toLowerCase()}`, user.id);
    expect(article.version).toBe(2);
    expect(article.helpful).toBe(true);
  }, 120_000);

  it("CASE-11: analytics derive from real case timestamps", async () => {
    const user = await createUser("analytics");
    await svc.cases.createCase(user.id, {
      category: "BILL_PAYMENT_ISSUE", linkedType: "GENERAL",
      description: "A bill payment concern that should appear in operations analytics.",
      idempotencyKey: `r19-case-11-${stamp}`,
    });
    const metrics = await svc.operations.getSupportOperations({ limit: 100 });
    expect(metrics.total).toBeGreaterThan(0);
    expect(metrics.byCategory["BILL_PAYMENT_ISSUE"]).toBeGreaterThan(0);
    expect(metrics.notice).toContain("No service-level commitment");
  }, 120_000);

  it("CASE-12: new support roles have least-privilege permissions", () => {
    expect(svc.controlAuth.hasPermission("SUPPORT_AGENT", "support:write")).toBe(true);
    expect(svc.controlAuth.hasPermission("SUPPORT_AGENT", "support:resolve")).toBe(false);
    expect(svc.controlAuth.hasPermission("SUPPORT_SUPERVISOR", "support:resolve")).toBe(true);
    expect(svc.controlAuth.hasPermission("SUPPORT_AGENT", "merchant:write")).toBe(false);
  });
});
