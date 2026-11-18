import { prisma } from "@nexus/database";
import type { ControlAccountsView } from "@nexus/shared-types";
import { runSyncWorker } from "@/lib/accounts/sync-service";

export async function getControlAccountsView(): Promise<ControlAccountsView> {
  const [
    providers, connections, activeConsents, expiredConsents, revokedConsents,
    failedJobs, health, backlog, duplicates, callbacks, quality,
  ] = await Promise.all([
    prisma.externalFinancialProvider.count(),
    prisma.externalAccountConnection.count(),
    prisma.externalAccountConsent.count({ where: { status: "ACTIVE" } }),
    prisma.externalAccountConsent.count({ where: { status: "EXPIRED" } }),
    prisma.externalAccountConsent.count({ where: { status: "REVOKED" } }),
    prisma.accountSyncJob.count({ where: { status: "DEAD_LETTER" } }),
    prisma.providerHealthSnapshot.findFirst({ orderBy: { capturedAt: "desc" } }),
    prisma.accountSyncJob.count({ where: { status: "PENDING" } }),
    prisma.transactionDeduplicationRecord.count({ where: { decision: "UNREVIEWED" } }),
    prisma.providerCallbackEvent.count({ where: { status: "FAILED" } }),
    prisma.dataAccessAuditEvent.count({ where: { action: { contains: "RECONCILIATION" } } }),
  ]);
  return {
    providers, connections, activeConsents, expiredConsents, revokedConsents,
    failedJobs, providerLatencyMs: health?.latencyMs ?? null,
    importBacklog: backlog, duplicateEvents: duplicates, callbackFailures: callbacks,
    reconciliationFailures: quality, lastHealthCheck: health?.capturedAt.toISOString() ?? null,
    currency: "INR",
  };
}

export async function listProviderHealth(limit = 50) {
  return prisma.providerHealthSnapshot.findMany({
    include: { provider: true }, orderBy: { capturedAt: "desc" }, take: limit,
  });
}

export async function listFailedJobs(limit = 50) {
  return prisma.accountSyncJob.findMany({
    where: { status: { in: ["FAILED", "DEAD_LETTER"] } },
    orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function listCallbackEvents(limit = 50) {
  return prisma.providerCallbackEvent.findMany({
    include: { provider: true }, orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function listAccessAudits(limit = 50) {
  return prisma.dataAccessAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function retryFailedJobs(userId: string) {
  const failed = await prisma.accountSyncJob.findMany({
    where: { status: "DEAD_LETTER" }, take: 20,
  });
  await prisma.accountSyncJob.updateMany({
    where: { id: { in: failed.map((job) => job.id) } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: null, error: null },
  });
  await prisma.dataAccessAuditEvent.create({
    data: {
      actorType: "ADMIN", actorId: userId, action: "EXTERNAL_SYNC_JOBS_RETRIED",
      targetType: "account_sync_job", targetId: `${failed.length}`,
    },
  });
  return runSyncWorker(20);
}
