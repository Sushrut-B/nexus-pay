import { prisma } from "@nexus/database";
import type { InvestmentOperationsView } from "@nexus/shared-types";

export async function getInvestmentOperations(): Promise<InvestmentOperationsView> {
  const [providers, available, connections, active, failedJobs, holdings, transactions, stale, lastSync] = await Promise.all([
    prisma.investmentProvider.count(),
    prisma.investmentProvider.count({ where: { status: "AVAILABLE" } }),
    prisma.investmentConnection.count(),
    prisma.investmentConnection.count({ where: { status: "ACTIVE" } }),
    prisma.investmentSyncJob.count({ where: { status: { in: ["FAILED", "DEAD_LETTER"] } } }),
    prisma.investmentHolding.count(),
    prisma.investmentTransaction.count(),
    prisma.investmentHolding.count({ where: { expiresAt: { lte: new Date() } } }),
    prisma.investmentProvider.findFirst({ where: { lastSyncAt: { not: null } }, orderBy: { lastSyncAt: "desc" }, select: { lastSyncAt: true } }),
  ]);
  return {
    providers, availableProviders: available, connections, activeConnections: active,
    syncJobsFailed: failedJobs, holdings, transactions, staleHoldings: stale,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null, currency: "INR",
  };
}

export async function listInvestmentProviders() {
  return prisma.investmentProvider.findMany({ include: { capabilityRows: true }, orderBy: { code: "asc" } });
}

export async function listSyncJobs(limit = 100) {
  return prisma.investmentSyncJob.findMany({
    include: { connection: true, provider: true }, orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function listSyncHistory(limit = 100) {
  return prisma.investmentSyncHistory.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}

export async function listDocuments(limit = 100) {
  return prisma.investmentDocument.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function retrySyncJob(id: string, actorId: string) {
  const job = await prisma.investmentSyncJob.findUniqueOrThrow({ where: { id } });
  if (job.status !== "FAILED" && job.status !== "DEAD_LETTER") {
    throw new Error("Only failed read-only sync jobs can be retried.");
  }
  const row = await prisma.investmentSyncJob.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), error: null, leaseUntil: null },
  });
  await prisma.securityAuditEvent.create({
    data: {
      actorType: "ADMIN", actorId, action: "INVESTMENT_SYNC_JOB_RETRIED",
      targetType: "investment_sync_job", targetId: id,
    },
  });
  return row;
}

export async function pauseProvider(code: string, actorId: string) {
  const row = await prisma.investmentProvider.update({ where: { code }, data: { status: "UNAVAILABLE" } });
  await prisma.securityAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "INVESTMENT_PROVIDER_PAUSED", targetType: "investment_provider", targetId: row.id },
  });
  return row;
}

export async function runInvestmentWorker() {
  const { runInvestmentSyncWorker } = await import("@/lib/investments/sync-service");
  return runInvestmentSyncWorker(25);
}
