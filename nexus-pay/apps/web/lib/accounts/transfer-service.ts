import { prisma } from "@nexus/database";
import type { InternalTransferStatus } from "@nexus/database";
import type { TransferMatchView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";

function toView(row: {
  id: string; debitTxId: string; creditTxId: string; amountMinor: number; currency: string;
  confidence: string; status: InternalTransferStatus; reason: string; createdAt: Date;
}): TransferMatchView {
  return {
    id: row.id, debitAccount: row.debitTxId, creditAccount: row.creditTxId,
    amountMinor: row.amountMinor, currency: row.currency, confidence: row.confidence,
    status: row.status, reason: row.reason, createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Identify likely transfers between the user's own connected accounts.
 * Suggestions never delete or merge transactions; only confirmed matches are
 * excluded from consolidated income/expense totals.
 */
export async function runInternalTransferDetection(userId: string): Promise<number> {
  const transactions = await prisma.externalTransaction.findMany({
    where: { userId, status: "POSTED" },
    orderBy: { transactionAt: "asc" },
    take: 1000,
  });
  const outflows = transactions.filter((tx) => tx.direction === "OUT");
  const inflows = transactions.filter((tx) => tx.direction === "IN");
  let created = 0;
  for (const debit of outflows) {
    for (const credit of inflows) {
      if (debit.accountId === credit.accountId) continue;
      if (debit.amountMinor !== credit.amountMinor || debit.currency !== credit.currency) continue;
      const gap = Math.abs(debit.transactionAt.getTime() - credit.transactionAt.getTime());
      if (gap > 48 * 86_400_000) continue;
      const confidence = gap <= 6 * 3_600_000 ? "HIGH" : gap <= 24 * 3_600_000 ? "MEDIUM" : "LOW";
      const reason = `Equal ${debit.currency} ${(debit.amountMinor / 100).toFixed(2)} movement between own accounts within ${Math.round(gap / 3_600_000)} hours.`;
      const existing = await prisma.internalTransferMatch.findUnique({
        where: { userId_debitTxId_creditTxId: { userId, debitTxId: debit.id, creditTxId: credit.id } },
      });
      if (existing) continue;
      await prisma.internalTransferMatch.create({
        data: {
          userId, debitTxId: debit.id, creditTxId: credit.id,
          amountMinor: debit.amountMinor, currency: debit.currency,
          confidence, status: "SUGGESTED", reason,
        },
      });
      created += 1;
      await createNotification(prisma, {
        userId, type: "INTERNAL_TRANSFER_SUGGESTED", title: "Possible transfer between your accounts",
        body: reason, data: { reason },
      });
    }
  }
  return created;
}

export async function listTransferMatches(userId: string, status?: InternalTransferStatus): Promise<TransferMatchView[]> {
  const rows = await prisma.internalTransferMatch.findMany({
    where: { userId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map(toView);
}

export async function decideTransferMatch(userId: string, id: string, decision: "CONFIRM" | "REJECT"): Promise<TransferMatchView> {
  const row = await prisma.internalTransferMatch.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Transfer match not found.");
  if (row.status !== "SUGGESTED") throw new ApiError(409, "PAYMENT_ERROR", "This match was already decided.");
  const updated = await prisma.internalTransferMatch.update({
    where: { id }, data: { status: decision === "CONFIRM" ? "CONFIRMED" : "REJECTED" },
  });
  return toView(updated);
}

export async function confirmedTransferIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.internalTransferMatch.findMany({
    where: { userId, status: "CONFIRMED" }, select: { debitTxId: true, creditTxId: true },
  });
  return new Set(rows.flatMap((row) => [row.debitTxId, row.creditTxId]));
}
