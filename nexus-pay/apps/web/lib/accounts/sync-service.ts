import { createHash } from "node:crypto";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { getProviderAdapter } from "@/lib/accounts/providers";
import { runInternalTransferDetection } from "@/lib/accounts/transfer-service";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export async function enqueueSync(connectionId: string, kind: "FULL_SYNC" | "INCREMENTAL_SYNC" | "BALANCE_REFRESH" = "INCREMENTAL_SYNC") {
  const connection = await prisma.externalAccountConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ApiError(404, "AUTHORIZATION_ERROR", "Connection not found.");
  if (["REVOKED", "FAILED"].includes(connection.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This connection cannot be synchronised.");
  }
  return prisma.accountSyncJob.create({
    data: { connectionId, userId: connection.userId, kind, status: "PENDING" },
  });
}

async function buildContext(connectionId: string) {
  const connection = await prisma.externalAccountConnection.findUniqueOrThrow({
    where: { id: connectionId }, include: { provider: true, accounts: true, consents: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } } },
  });
  const consent = connection.consents[0];
  if (!consent) throw new Error("No active consent — retrieval blocked");
  if (consent.revokedAt || consent.expiresAt <= new Date()) throw new Error("Consent expired or revoked — retrieval blocked");
  if (connection.status === "REVOKED") throw new Error("Connection revoked — retrieval blocked");
  if (!consent.dataCategories.includes("BALANCES") && !consent.dataCategories.includes("TRANSACTIONS")) {
    throw new Error("Consent does not permit data retrieval");
  }
  return {
    connection,
    consent,
    adapter: getProviderAdapter(connection.provider.code),
    ctx: {
      userId: connection.userId,
      providerConnectionRef: connection.providerConnectionRef ?? connection.id,
      accountRefs: connection.accounts.map((account) => account.providerAccountRef),
      consentRef: consent.providerConsentRef,
      encryptedToken: null,
    },
  };
}

/** Claim and execute one due sync job. Safe for multiple workers. */
export async function processSyncJob(jobId: string): Promise<"processed" | "skipped"> {
  const job = await prisma.accountSyncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return "skipped";
  const claimed = await prisma.accountSyncJob.updateMany({
    where: {
      id: jobId, status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count === 0) return "skipped";

  try {
    const { connection, adapter, ctx } = await buildContext(job.connectionId);
    const accountsData = await adapter.fetchAccounts(ctx);
    for (const account of accountsData) {
      await prisma.externalFinancialAccount.upsert({
        where: {
          connectionId_providerAccountRef: {
            connectionId: connection.id, providerAccountRef: account.providerAccountRef,
          },
        },
        create: {
          connectionId: connection.id,
          userId: connection.userId,
          providerAccountRef: account.providerAccountRef,
          accountType: account.accountType,
          institutionName: account.institutionName,
          maskedIdentifier: account.maskedIdentifier,
          encryptedAccountRef: account.secretReference.startsWith("enc:") ? account.secretReference : `enc:${createHash("sha256").update(account.secretReference).digest("hex")}`,
          currency: account.currency,
        },
        update: { institutionName: account.institutionName, maskedIdentifier: account.maskedIdentifier, status: "ACTIVE" },
      });
    }

    if (job.kind === "BALANCE_REFRESH") {
      const balances = await adapter.fetchBalances(ctx);
      for (const balance of balances) {
        const account = await prisma.externalFinancialAccount.findUnique({
          where: {
            connectionId_providerAccountRef: {
              connectionId: connection.id, providerAccountRef: balance.providerAccountRef,
            },
          },
        });
        if (!account) continue;
        await prisma.externalAccountBalanceSnapshot.create({
          data: {
            accountId: account.id,
            reportedBalanceMinor: BigInt(balance.reportedBalanceMinor),
            availableBalanceMinor: balance.availableBalanceMinor == null ? null : BigInt(balance.availableBalanceMinor),
            currency: balance.currency,
            providerReportedAt: balance.reportedAt,
            liability: balance.liability,
            outstandingMinor: balance.outstandingMinor == null ? null : BigInt(balance.outstandingMinor),
            availableCreditMinor: balance.availableCreditMinor == null ? null : BigInt(balance.availableCreditMinor),
            statementMinor: balance.statementMinor == null ? null : BigInt(balance.statementMinor),
            minimumDueMinor: balance.minimumDueMinor == null ? null : BigInt(balance.minimumDueMinor),
            paymentDueDate: balance.paymentDueDate ?? null,
            statementPeriodStart: balance.statementPeriodStart ?? null,
            statementPeriodEnd: balance.statementPeriodEnd ?? null,
          },
        });
      }
    }

    if (job.kind !== "BALANCE_REFRESH" && adapter.capabilities.transactions) {
      const checkpoint = await prisma.accountSyncCheckpoint.findMany({ where: { connectionId: connection.id } });
      const cursorByAccount = new Map(checkpoint.map((row) => [row.accountId, row.cursor]));
      let imported = 0;
      let duplicates = 0;
      for (const account of await prisma.externalFinancialAccount.findMany({ where: { connectionId: connection.id } })) {
        const result = await adapter.fetchTransactions(
          { ...ctx, accountRefs: [account.providerAccountRef] },
          cursorByAccount.get(account.id) ?? null,
        );
        const importRow = await prisma.externalTransactionImport.create({
          data: { connectionId: connection.id, accountId: account.id, status: "PROCESSING" },
        });
        for (const transaction of result.transactions) {
          const created = await prisma.externalTransaction.upsert({
            where: {
              accountId_providerTxRef: {
                accountId: account.id, providerTxRef: transaction.providerTxRef,
              },
            },
            create: {
              accountId: account.id,
              userId: connection.userId,
              providerTxRef: transaction.providerTxRef,
              importId: importRow.id,
              amountMinor: transaction.amountMinor,
              currency: transaction.currency,
              direction: transaction.direction,
              description: transaction.description,
              merchant: transaction.merchant ?? null,
              category: transaction.category ?? "OTHER",
              transactionAt: transaction.transactionAt,
              postedAt: transaction.postedAt ?? null,
              status: transaction.status,
              externalRef: transaction.externalRef ?? null,
              rawPayload: (transaction.rawPayload ?? {}) as object,
            },
            update: { status: transaction.status },
          });
          const isNew = created.importId === importRow.id;
          if (isNew) imported += 1;
          else duplicates += 1;
          await prisma.transactionDeduplicationRecord.upsert({
            where: {
              userId_canonicalTxId_candidateKey: {
                userId: connection.userId,
                canonicalTxId: created.id,
                candidateKey: `${account.id}:${transaction.providerTxRef}`,
              },
            },
            create: {
              userId: connection.userId,
              canonicalTxId: created.id,
              candidateKey: `${account.id}:${transaction.providerTxRef}`,
              decision: "DUPLICATE",
              confidence: "HIGH",
              reason: "Stable provider transaction reference",
            },
            update: {},
          });
        }
        await prisma.externalTransactionImport.update({
          where: { id: importRow.id },
          data: {
            cursor: result.nextCursor,
            importedCount: imported,
            duplicateCount: duplicates,
            status: "COMPLETED",
            finishedAt: new Date(),
          },
        });
        await prisma.accountSyncCheckpoint.upsert({
          where: { connectionId_accountId: { connectionId: connection.id, accountId: account.id } },
          create: { connectionId: connection.id, accountId: account.id, cursor: result.nextCursor, lastTransactionAt: new Date() },
          update: { cursor: result.nextCursor, lastTransactionAt: new Date() },
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.accountSyncJob.update({ where: { id: jobId }, data: { status: "COMPLETED", leaseUntil: null, completedAt: new Date() } });
      await tx.externalAccountConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastError: null, status: "ACTIVE" },
      });
      await tx.providerHealthSnapshot.create({
        data: { providerId: connection.providerId, status: "HEALTHY", latencyMs: Date.now() - job.createdAt.getTime() },
      });
    });
    await runInternalTransferDetection(connection.userId);
    return "processed";
  } catch (error) {
    const attempts = job.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message : "Synchronisation failed";
    await prisma.$transaction(async (tx) => {
      await tx.accountSyncJob.update({
        where: { id: jobId },
        data: {
          status: dead ? "DEAD_LETTER" : "PENDING",
          leaseUntil: null,
          error: message.slice(0, 500),
          nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
        },
      });
      await tx.externalAccountConnection.update({
        where: { id: job.connectionId },
        data: { status: message.includes("Consent") || message.includes("revoked") ? "REVOKED" : "REQUIRES_ATTENTION", lastError: message.slice(0, 500) },
      });
      await tx.providerHealthSnapshot.create({
        data: { providerId: (await tx.externalAccountConnection.findUniqueOrThrow({ where: { id: job.connectionId } })).providerId, status: "DEGRADED", details: message.slice(0, 500) },
      });
    });
    if (dead || message.includes("Consent")) {
      await createNotification(prisma, {
        userId: job.userId, type: "EXTERNAL_ACCOUNT_SYNC_FAILED", title: "Account synchronisation needs attention",
        body: "We could not refresh an external account. No money was moved.", data: { connectionId: job.connectionId },
      });
    }
    return "processed";
  }
}

export async function runSyncWorker(limit = 25): Promise<{ processed: number }> {
  const due = await prisma.accountSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of due) {
    await processSyncJob(job.id);
    processed += 1;
  }
  return { processed };
}

export async function getSyncStatus(userId: string, connectionId: string) {
  const connection = await prisma.externalAccountConnection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) throw new ApiError(404, "AUTHORIZATION_ERROR", "Connection not found.");
  const jobs = await prisma.accountSyncJob.findMany({ where: { connectionId }, orderBy: { createdAt: "desc" }, take: 10 });
  return { connectionId, jobs: jobs.map((job) => ({ id: job.id, kind: job.kind, status: job.status, attempts: job.attempts, error: job.error })) };
}

export async function getSyncHistory(userId: string, limit = 50) {
  const connections = await prisma.externalAccountConnection.findMany({ where: { userId }, select: { id: true } });
  const rows = await prisma.externalTransactionImport.findMany({
    where: { connectionId: { in: connections.map((connection) => connection.id) } },
    orderBy: { startedAt: "desc" }, take: limit,
  });
  return rows.map((row) => ({
    id: row.id, connectionId: row.connectionId, accountId: row.accountId,
    importedCount: row.importedCount, duplicateCount: row.duplicateCount,
    status: row.status, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}
