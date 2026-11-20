import { prisma } from "@nexus/database";
import { ensureInvestmentRecords } from "@/lib/investments/providers";
import { runInvestmentSyncWorker } from "@/lib/investments/sync-service";
import { evaluatePriceAlerts } from "@/lib/investments/discovery-service";
import { capturePortfolioSnapshot } from "@/lib/investments/portfolio-service";
import { captureNetWorthSnapshot } from "@/lib/investments/wealth-service";

const globalForInvestments = globalThis as unknown as {
  nexusPayInvestmentsWorkerStarted?: boolean;
  nexusPayInvestmentsWorkerRunning?: boolean;
  nexusPayInvestmentsConfigured?: boolean;
};

let configPromise: Promise<void> | null = null;

export function ensureInvestmentConfiguration(): Promise<void> {
  if (!configPromise) {
    configPromise = ensureInvestmentRecords().catch((error) => { configPromise = null; throw error; });
  }
  return configPromise;
}

async function expireConsents() {
  const expired = await prisma.investmentConsent.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: new Date() } }, take: 100,
  });
  for (const consent of expired) {
    await prisma.$transaction([
      prisma.investmentConsent.update({ where: { id: consent.id }, data: { status: "EXPIRED" } }),
      prisma.investmentConsentEvent.create({ data: { consentId: consent.id, event: "CONSENT_EXPIRED", actor: "system" } }),
      prisma.investmentConnection.update({ where: { id: consent.connectionId }, data: { status: "CONSENT_EXPIRED" } }),
    ]);
  }
  return expired.length;
}

async function captureDueSnapshots() {
  const since = Date.now() - 24 * 3_600_000;
  const users = await prisma.investmentAccount.findMany({
    where: { status: "ACTIVE" }, select: { userId: true }, distinct: ["userId"], take: 20,
  });
  for (const row of users) {
    const recent = await prisma.portfolioSnapshot.count({ where: { userId: row.userId, capturedAt: { gte: new Date(since) } } });
    if (recent > 0) continue;
    await capturePortfolioSnapshot(row.userId).catch(() => undefined);
    await captureNetWorthSnapshot(row.userId).catch(() => undefined);
  }
}

export function startInvestmentWorker(intervalMs = 60_000): void {
  if (globalForInvestments.nexusPayInvestmentsWorkerStarted) return;
  globalForInvestments.nexusPayInvestmentsWorkerStarted = true;
  if (!globalForInvestments.nexusPayInvestmentsConfigured) {
    globalForInvestments.nexusPayInvestmentsConfigured = true;
    void ensureInvestmentConfiguration().catch(() => undefined);
  }
  setInterval(() => {
    if (globalForInvestments.nexusPayInvestmentsWorkerRunning) return;
    globalForInvestments.nexusPayInvestmentsWorkerRunning = true;
    Promise.all([
      runInvestmentSyncWorker(25),
      evaluatePriceAlerts(),
      expireConsents(),
      captureDueSnapshots(),
    ]).catch(() => undefined).finally(() => { globalForInvestments.nexusPayInvestmentsWorkerRunning = false; });
  }, intervalMs);
}
