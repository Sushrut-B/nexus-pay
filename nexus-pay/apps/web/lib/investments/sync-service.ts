import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { adapterForConnection } from "@/lib/investments/connection-service";
import { createNotification } from "@/lib/social/shared";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export async function enqueueInvestmentSync(connectionId: string, kind = "INCREMENTAL_SYNC") {
  const connection = await prisma.investmentConnection.findUniqueOrThrow({
    where: { id: connectionId }, include: { provider: true },
  });
  return prisma.investmentSyncJob.create({
    data: { connectionId, providerId: connection.providerId, kind },
  });
}

export async function getSyncStatus(userId: string, connectionId: string) {
  const jobs = await prisma.investmentSyncJob.findMany({
    where: { connectionId, connection: { userId } },
    orderBy: { createdAt: "desc" }, take: 20,
  });
  return jobs.map((job) => ({
    id: job.id, kind: job.kind, status: job.status, attempts: job.attempts,
    error: job.error, createdAt: job.createdAt.toISOString(),
  }));
}

export async function getSyncHistory(userId: string, limit = 50) {
  const connections = await prisma.investmentConnection.findMany({ where: { userId }, select: { id: true } });
  return prisma.investmentSyncHistory.findMany({
    where: { connectionId: { in: connections.map((item) => item.id) } },
    orderBy: { startedAt: "desc" }, take: limit,
  });
}

async function importSnapshot(connectionId: string): Promise<{ accounts: number; holdings: number; transactions: number }> {
  const { connection, adapter } = await adapterForConnection(connectionId);
  const accounts = await adapter.discoverAccounts({ userId: connection.userId });
  let accountCount = 0;
  let holdingCount = 0;
  let transactionCount = 0;

  for (const account of accounts) {
    const row = await prisma.investmentAccount.upsert({
      where: { connectionId_providerRef: { connectionId, providerRef: account.providerRef } },
      create: {
        userId: connection.userId, connectionId,
        providerRef: account.providerRef, name: account.name,
        accountType: account.accountType, maskedNumber: account.maskedNumber ?? null,
        currency: account.currency, source: "PROVIDER", lastSyncedAt: new Date(),
      },
      update: { name: account.name, lastSyncedAt: new Date(), status: "ACTIVE" },
    });
    accountCount += 1;

    const holdings = await adapter.getHoldings(account.providerRef);
    for (const holding of holdings) {
      await prisma.investmentHolding.upsert({
        where: { accountId_providerRef: { accountId: row.id, providerRef: holding.providerRef } },
        create: {
          userId: connection.userId, accountId: row.id, providerRef: holding.providerRef,
          name: holding.name, assetClass: holding.assetClass,
          quantityMinor: holding.quantityMinor ?? null, navMinor: holding.navMinor ?? null,
          costMinor: holding.costMinor ?? null, valueMinor: holding.valueMinor,
          currency: holding.currency, source: "PROVIDER",
          providerReportedAt: holding.providerReportedAt,
          expiresAt: new Date(holding.providerReportedAt.getTime() + 30 * 86_400_000),
        },
        update: {
          name: holding.name, assetClass: holding.assetClass,
          valueMinor: holding.valueMinor, navMinor: holding.navMinor ?? null,
          costMinor: holding.costMinor ?? null, quantityMinor: holding.quantityMinor ?? null,
          providerReportedAt: holding.providerReportedAt,
          expiresAt: new Date(holding.providerReportedAt.getTime() + 30 * 86_400_000),
        },
      });
      holdingCount += 1;
    }

    const transactions = await adapter.getTransactions(account.providerRef);
    for (const tx of transactions) {
      await prisma.investmentTransaction.upsert({
        where: { accountId_providerRef: { accountId: row.id, providerRef: tx.providerRef } },
        create: {
          userId: connection.userId, accountId: row.id, providerRef: tx.providerRef,
          type: tx.type, quantityMinor: tx.quantityMinor ?? null, priceMinor: tx.priceMinor ?? null,
          amountMinor: tx.amountMinor, currency: "INR", occurredAt: tx.occurredAt,
          settledAt: tx.settledAt ?? null, providerStatus: tx.providerStatus ?? null,
          source: "PROVIDER",
        },
        update: { providerStatus: tx.providerStatus ?? null, settledAt: tx.settledAt ?? null },
      });
      transactionCount += 1;
    }

    const valuation = await adapter.getValuation(account.providerRef);
    if (valuation) {
      await prisma.investmentValuation.upsert({
        where: { accountId_valuedAt: { accountId: row.id, valuedAt: valuation.valuedAt } },
        create: {
          userId: connection.userId, accountId: row.id, valueMinor: valuation.valueMinor,
          costMinor: valuation.costMinor, currency: valuation.currency, valuedAt: valuation.valuedAt,
        },
        update: {},
      });
    }
  }

  const sips = await adapter.listSips();
  for (const sip of sips) {
    await prisma.sIPTrackingRecord.upsert({
      where: { userId_schemeCode_providerRef: { userId: connection.userId, schemeCode: sip.schemeCode, providerRef: sip.providerRef } },
      create: {
        userId: connection.userId, connectionId, schemeCode: sip.schemeCode, schemeName: sip.schemeName,
        amountMinor: sip.amountMinor, frequency: sip.frequency, startDate: sip.startDate ?? null,
        nextInstalmentDate: sip.nextInstalmentDate ?? null,
        instalmentsCompleted: sip.instalmentsCompleted ?? 0, investedMinor: sip.investedMinor ?? 0,
        currentValueMinor: sip.currentValueMinor ?? null, status: "UNKNOWN",
        providerRef: sip.providerRef, source: "PROVIDER", providerReportedAt: sip.providerReportedAt,
      },
      update: {
        schemeName: sip.schemeName, amountMinor: sip.amountMinor,
        nextInstalmentDate: sip.nextInstalmentDate ?? null,
        instalmentsCompleted: sip.instalmentsCompleted ?? 0, investedMinor: sip.investedMinor ?? 0,
        currentValueMinor: sip.currentValueMinor ?? null, providerReportedAt: sip.providerReportedAt,
      },
    });
  }

  const funds = await adapter.listFunds();
  for (const fund of funds) {
    await prisma.mutualFundScheme.upsert({
      where: { code: fund.code },
      create: {
        providerId: connection.providerId, code: fund.code, name: fund.name, amc: fund.amc,
        category: fund.category, planType: fund.planType, optionType: fund.optionType,
        navMinor: fund.navMinor ?? null, navDate: fund.navDate ?? null,
        expenseRatioBps: fund.expenseRatioBps ?? null, inceptionDate: fund.inceptionDate ?? null,
        minInvestmentMinor: fund.minInvestmentMinor ?? null, minSipMinor: fund.minSipMinor ?? null,
        exitLoad: fund.exitLoad ?? null, riskometer: fund.riskometer ?? null,
        benchmark: fund.benchmark ?? null, performance: (fund.performance ?? {}) as object,
        documents: (fund.documents ?? []) as object, retrievedAt: fund.retrievedAt,
      },
      update: {
        name: fund.name, navMinor: fund.navMinor ?? null, navDate: fund.navDate ?? null,
        performance: (fund.performance ?? {}) as object, retrievedAt: fund.retrievedAt,
      },
    });
  }

  const instruments = await adapter.searchInstruments("SBN");
  for (const instrument of instruments) {
    await prisma.investmentInstrument.upsert({
      where: { symbol: instrument.symbol },
      create: {
        providerId: connection.providerId, symbol: instrument.symbol, name: instrument.name,
        exchange: instrument.exchange ?? null, category: instrument.category,
        sector: instrument.sector ?? null, source: "SANDBOX_FIXTURE", retrievedAt: instrument.retrievedAt,
      },
      update: { name: instrument.name, retrievedAt: instrument.retrievedAt },
    });
    await prisma.instrumentPriceHistory.create({
      data: {
        instrumentId: (await prisma.investmentInstrument.findUniqueOrThrow({ where: { symbol: instrument.symbol } })).id,
        priceMinor: instrument.priceMinor, changeMinor: instrument.changeMinor,
        changePct: instrument.changePct, feedType: instrument.feedType, recordedAt: instrument.retrievedAt,
      },
    });
  }
  return { accounts: accountCount, holdings: holdingCount, transactions: transactionCount };
}

export async function processInvestmentSyncJob(jobId: string): Promise<"processed" | "skipped"> {
  const claimed = await prisma.investmentSyncJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count === 0) return "skipped";
  const job = await prisma.investmentSyncJob.findUniqueOrThrow({ where: { id: jobId } });
  const history = await prisma.investmentSyncHistory.create({
    data: { connectionId: job.connectionId, status: "PROCESSING" },
  });
  try {
    const result = await importSnapshot(job.connectionId);
    await prisma.$transaction([
      prisma.investmentSyncJob.update({ where: { id: jobId }, data: { status: "COMPLETED", leaseUntil: null, completedAt: new Date() } }),
      prisma.investmentConnection.update({ where: { id: job.connectionId }, data: { status: "ACTIVE", lastSyncAt: new Date(), lastError: null } }),
      prisma.investmentProvider.update({ where: { id: job.providerId }, data: { lastSyncAt: new Date() } }),
      prisma.investmentSyncHistory.update({
        where: { id: history.id },
        data: {
          status: "COMPLETED", accountsSeen: result.accounts, holdingsSeen: result.holdings,
          transactionsSeen: result.transactions, finishedAt: new Date(),
        },
      }),
    ]);
    await publishSecurityEvent({
      eventId: `inv_sync_${job.id}`, type: "INVESTMENT_SYNC_COMPLETED", occurredAt: new Date(),
      subjectId: job.connectionId, sourceModule: "investments",
      metadata: { ...result },
    });
    return "processed";
  } catch (error) {
    const dead = job.attempts + 1 >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Sync failed";
    const consentError = error instanceof ApiError && error.status === 403;
    await prisma.$transaction([
      prisma.investmentSyncJob.update({
        where: { id: jobId },
        data: {
          status: dead || consentError ? "FAILED" : "PENDING", leaseUntil: null, error: message,
          nextAttemptAt: dead || consentError ? null : new Date(Date.now() + 60_000 * (job.attempts + 1)),
        },
      }),
      prisma.investmentSyncHistory.update({ where: { id: history.id }, data: { status: "FAILED", detail: message, finishedAt: new Date() } }),
      prisma.investmentConnection.update({
        where: { id: job.connectionId },
        data: { status: consentError ? "REVOKED" : "SYNC_FAILED", lastError: message },
      }),
    ]);
    const connection = await prisma.investmentConnection.findUniqueOrThrow({ where: { id: job.connectionId } });
    const userExists = await prisma.user.findUnique({ where: { id: connection.userId }, select: { id: true } });
    if (!userExists) return "skipped";
    await createNotification(prisma, {
      userId: connection.userId, type: "INVESTMENT_PROVIDER_FAILURE",
      title: "Investment sync needs attention",
      body: "Your investment provider could not be synchronized. No holdings were changed by this failure.",
      data: { connectionId: job.connectionId },
    }).catch(() => undefined);
    await securityAudit({
      actorType: "SYSTEM", actorId: "investment-sync", action: "INVESTMENT_SYNC_FAILED",
      targetType: "investment_sync_job", targetId: jobId, metadata: { error: message }, outcome: "FAILURE",
    });
    return "skipped";
  }
}

export async function runInvestmentSyncWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.investmentSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    if ((await processInvestmentSyncJob(job.id)) === "processed") processed += 1;
  }
  return { processed };
}
