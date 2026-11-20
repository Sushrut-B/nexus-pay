import { prisma } from "@nexus/database";
import type { TaxOperationsView } from "@nexus/shared-types";

export async function getTaxOperations(): Promise<TaxOperationsView> {
  const [
    ruleSets, published, calculations, failedJobs, documents, failedDocuments,
    exceptions, reminders,
  ] = await Promise.all([
    prisma.taxRuleSet.count(),
    prisma.taxRuleSet.count({ where: { status: "PUBLISHED" } }),
    prisma.taxCalculation.count(),
    prisma.taxSyncJob.count({ where: { status: { in: ["FAILED", "DEAD_LETTER"] } } }),
    prisma.taxDocument.count({ where: { status: { not: "DELETED" } } }),
    prisma.taxDocument.count({ where: { status: "FAILED" } }),
    prisma.taxReconciliationRecord.count({ where: { status: "PENDING" } }),
    prisma.taxReminder.count({ where: { sentAt: { not: null } } }),
  ]);
  return {
    ruleSets, publishedRuleSets: published, calculations, failedJobs,
    documents, failedDocuments, reconciliationExceptions: exceptions, remindersSent: reminders,
    currency: "INR",
  };
}

export async function listTaxRuleSets() {
  return prisma.taxRuleSet.findMany({ include: { slabs: true, deductions: true, exemptions: true }, orderBy: { createdAt: "desc" } });
}

export async function listTaxJobs(limit = 100) {
  return prisma.taxSyncJob.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function listReconciliationExceptions(limit = 100) {
  return prisma.taxReconciliationRecord.findMany({
    where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function retryTaxJob(id: string, actorId: string) {
  const job = await prisma.taxSyncJob.findUniqueOrThrow({ where: { id } });
  if (job.status !== "FAILED" && job.status !== "DEAD_LETTER") throw new Error("Only failed jobs can be retried.");
  const row = await prisma.taxSyncJob.update({
    where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), error: null, leaseUntil: null },
  });
  await prisma.taxAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "TAX_JOB_RETRIED", targetType: "tax_sync_job", targetId: id },
  });
  return row;
}

export async function pauseTaxJob(id: string, actorId: string) {
  const row = await prisma.taxSyncJob.update({
    where: { id }, data: { status: "FAILED", error: "Paused by operator", leaseUntil: null },
  });
  await prisma.taxAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "TAX_JOB_PAUSED", targetType: "tax_sync_job", targetId: id },
  });
  return row;
}

export async function publishRuleSet(version: string, actorId: string) {
  const row = await prisma.taxRuleSet.update({
    where: { version }, data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  await prisma.taxAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "TAX_RULESET_PUBLISHED", targetType: "tax_rule_set", targetId: row.id, metadata: { version } },
  });
  return row;
}

export async function listTaxAudit(limit = 100) {
  return prisma.taxAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
