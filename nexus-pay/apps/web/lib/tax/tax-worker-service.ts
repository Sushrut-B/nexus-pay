import { prisma } from "@nexus/database";
import { createNotification } from "@/lib/social/shared";
import { securityAudit } from "@/lib/fraud/audit-service";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export async function enqueueTaxJob(userId: string, kind: string, payload: Record<string, unknown> = {}) {
  return prisma.taxSyncJob.create({ data: { userId, kind, payload: payload as object } });
}

async function processDocumentExtraction(jobId: string, payload: Record<string, unknown>) {
  const documentId = String(payload.documentId ?? "");
  const doc = await prisma.taxDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  // Extraction pipeline is an extension point: no OCR engine is installed in this repository.
  // Only clearly-labelled placeholder fields are recorded, all requiring user confirmation.
  const { recordExtraction } = await import("@/lib/tax/tax-document-service");
  await recordExtraction(doc.userId, documentId, [
    { field: "DOCUMENT_TYPE", value: doc.kind, confidenceBps: 1000 },
    { field: "FINANCIAL_YEAR", value: doc.financialYear, confidenceBps: 1000 },
  ]);
  return { documentId, extracted: 2 };
}

async function processJob(jobId: string): Promise<"processed" | "skipped"> {
  const claimed = await prisma.taxSyncJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count === 0) return "skipped";
  const job = await prisma.taxSyncJob.findUniqueOrThrow({ where: { id: jobId } });
  const history = await prisma.taxSyncHistory.create({ data: { userId: job.userId, kind: job.kind, status: "PROCESSING" } });
  try {
    const payload = job.payload as Record<string, unknown>;
    let detail = "Job completed";
    if (job.kind === "DOCUMENT_EXTRACTION") {
      const result = await processDocumentExtraction(jobId, payload);
      detail = `Extracted ${result.extracted} unconfirmed field(s)`;
    } else if (job.kind === "INCOME_CONSOLIDATION") {
      const { consolidateIncome } = await import("@/lib/tax/tax-mapping-service");
      const result = await consolidateIncome(job.userId, String(payload.financialYear ?? "2025-26"));
      detail = `Consolidated ${result.consolidated} income record(s)`;
    } else if (job.kind === "REPORT_GENERATION") {
      detail = "Tax preparation summary queued for user review";
    }
    await prisma.$transaction([
      prisma.taxSyncJob.update({ where: { id: jobId }, data: { status: "COMPLETED", leaseUntil: null, completedAt: new Date() } }),
      prisma.taxSyncHistory.update({ where: { id: history.id }, data: { status: "COMPLETED", detail, finishedAt: new Date() } }),
    ]);
    return "processed";
  } catch (error) {
    const dead = job.attempts + 1 >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Tax job failed";
    await prisma.$transaction([
      prisma.taxSyncJob.update({
        where: { id: jobId },
        data: {
          status: dead ? "FAILED" : "PENDING", leaseUntil: null, error: message,
          nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * (job.attempts + 1)),
        },
      }),
      prisma.taxSyncHistory.update({ where: { id: history.id }, data: { status: "FAILED", detail: message, finishedAt: new Date() } }),
    ]);
    await securityAudit({ actorType: "SYSTEM", actorId: "tax-worker", action: "TAX_JOB_FAILED", targetType: "tax_sync_job", targetId: jobId, metadata: { error: message }, outcome: "FAILURE" });
    return "skipped";
  }
}

export async function runTaxWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.taxSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) if ((await processJob(job.id)) === "processed") processed += 1;
  return { processed };
}

export async function sendDeadlineReminders() {
  const due = await prisma.taxReminder.findMany({
    where: { status: "PENDING", dueAt: { lte: new Date(Date.now() + 7 * 86_400_000) } }, take: 100,
  });
  let sent = 0;
  for (const reminder of due) {
    const existing = await prisma.taxReminder.findUnique({ where: { id: reminder.id } });
    if (!existing || existing.sentAt) continue;
    await prisma.taxReminder.update({ where: { id: reminder.id }, data: { sentAt: new Date() } });
    await createNotification(prisma, {
      userId: reminder.userId, type: "TAX_DEADLINE_REMINDER", title: "Tax deadline approaching",
      body: "A tax deadline is approaching. Verify the official source before acting. No return has been filed by Nexus Pay.",
      data: { reminderId: reminder.id },
    });
    sent += 1;
  }
  return { sent };
}

export async function seedDeadlines() {
  const entries = [
    { fy: "2025-26", code: "ADVANCE_TAX_1", title: "Advance tax instalment 1", date: "2025-06-15" },
    { fy: "2025-26", code: "ADVANCE_TAX_2", title: "Advance tax instalment 2", date: "2025-09-15" },
    { fy: "2025-26", code: "ADVANCE_TAX_3", title: "Advance tax instalment 3", date: "2025-12-15" },
    { fy: "2025-26", code: "ADVANCE_TAX_4", title: "Advance tax instalment 4", date: "2026-03-15" },
    { fy: "2025-26", code: "ITR_DUE", title: "Income tax return filing due date (indicative)", date: "2026-07-31" },
  ];
  for (const entry of entries) {
    await prisma.taxDeadline.upsert({
      where: { financialYear_code: { financialYear: entry.fy, code: entry.code } },
      create: {
        financialYear: entry.fy, code: entry.code, title: entry.title,
        dueDate: new Date(entry.date),
        sourceRef: "Indicative dates based on customary Income Tax Department schedules; verify current official notifications before relying on them.",
      },
      update: {},
    });
  }
}
