import { prisma } from "@nexus/database";
import type { DedupDecision } from "@nexus/database";
import { ApiError } from "@/lib/api/response";

export interface SuspectedDuplicate {
  key: string;
  transactionIds: string[];
  amountMinor: number;
  currency: string;
  transactionAt: string;
  confidence: string;
  reason: string;
}

/**
 * Finds possible duplicates from overlapping sync windows. Stable provider refs
 * are authoritative; heuristic matches are only suggestions. Nothing is merged.
 */
export async function findSuspectedDuplicates(userId: string): Promise<SuspectedDuplicate[]> {
  const transactions = await prisma.externalTransaction.findMany({
    where: { userId }, orderBy: { transactionAt: "asc" }, take: 2000,
  });
  const groups = new Map<string, typeof transactions>();
  for (const transaction of transactions) {
    const day = transaction.transactionAt.toISOString().slice(0, 10);
    const key = `${transaction.accountId}:${transaction.amountMinor}:${transaction.currency}:${day}:${transaction.direction}:${transaction.merchant ?? transaction.description}`;
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }
  const result: SuspectedDuplicate[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;
    const distinctRefs = new Set(group.map((tx) => tx.providerTxRef));
    if (distinctRefs.size === 1) continue; // already canonical by provider reference
    const sameMinute = Math.abs(group[0]!.transactionAt.getTime() - group[group.length - 1]!.transactionAt.getTime()) <= 60_000;
    const confidence = sameMinute ? "MEDIUM" : "LOW";
    const reason = `${group.length} imports share account, amount, currency and date but have different provider references.`;
    for (const transaction of group) {
      await prisma.transactionDeduplicationRecord.upsert({
        where: {
          userId_canonicalTxId_candidateKey: {
            userId, canonicalTxId: transaction.id, candidateKey: key,
          },
        },
        create: {
          userId, canonicalTxId: transaction.id, candidateKey: key,
          decision: "UNREVIEWED", confidence, reason,
        },
        update: {},
      });
    }
    result.push({
      key, transactionIds: group.map((tx) => tx.id), amountMinor: group[0]!.amountMinor,
      currency: group[0]!.currency, transactionAt: group[0]!.transactionAt.toISOString(),
      confidence, reason,
    });
  }
  return result;
}

export async function listDeduplicationRecords(userId: string, decision?: DedupDecision) {
  return prisma.transactionDeduplicationRecord.findMany({
    where: { userId, ...(decision ? { decision } : {}) },
    orderBy: { createdAt: "desc" }, take: 100,
  });
}

export async function decideDuplicate(userId: string, id: string, decision: DedupDecision): Promise<void> {
  const record = await prisma.transactionDeduplicationRecord.findFirst({ where: { id, userId } });
  if (!record) throw new ApiError(404, "AUTHORIZATION_ERROR", "Deduplication record not found.");
  await prisma.transactionDeduplicationRecord.update({ where: { id }, data: { decision } });
}
