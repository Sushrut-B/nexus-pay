import { prisma } from "@nexus/database";
import type { RecurrenceFrequency, RecurrencePatternStatus } from "@nexus/database";
import type { RecurringPatternView } from "@nexus/shared-types";
import type { RecurringPatternUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";

interface Candidate {
  merchantKey: string;
  amounts: number[];
  dates: Date[];
  refs: Array<{ type: string; id: string; amountMinor: number; at: Date }>;
}

function intervalFrequency(gaps: number[]): { frequency: RecurrenceFrequency; intervalCount: number } {
  const avg = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
  const days = avg / 86_400_000;
  if (days >= 5 && days <= 9) return { frequency: "WEEKLY", intervalCount: 1 };
  if (days >= 10 && days <= 18) return { frequency: "FORTNIGHTLY", intervalCount: 1 };
  if (days >= 25 && days <= 38) return { frequency: "MONTHLY", intervalCount: 1 };
  if (days >= 80 && days <= 100) return { frequency: "QUARTERLY", intervalCount: 1 };
  if (days >= 350 && days <= 380) return { frequency: "YEARLY", intervalCount: 1 };
  return { frequency: "CUSTOM", intervalCount: Math.max(1, Math.round(days)) };
}

function toView(pattern: {
  id: string; merchantKey: string; amountMinor: number; frequency: RecurrenceFrequency;
  confidence: string; status: RecurrencePatternStatus; lastSeenAt: Date; nextExpectedAt: Date | null;
  currency: string; _count?: { evidence: number };
}, evidenceCount: number): RecurringPatternView {
  return {
    id: pattern.id,
    merchant: pattern.merchantKey,
    amountMinor: pattern.amountMinor,
    frequency: pattern.frequency,
    confidence: pattern.confidence,
    status: pattern.status,
    lastSeenAt: pattern.lastSeenAt.toISOString(),
    nextExpectedAt: pattern.nextExpectedAt?.toISOString() ?? null,
    evidenceCount,
    currency: pattern.currency,
  };
}

/** Detects candidate recurring expenses. Never creates a scheduled payment. */
export async function detectRecurringPatterns(userId: string): Promise<RecurringPatternView[]> {
  const since = new Date(Date.now() - 395 * 86_400_000);
  const [payments, transactions] = await Promise.all([
    prisma.merchantPayment.findMany({
      where: { customerUserId: userId, status: "SETTLED", createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 2000,
    }),
    prisma.transactionRecord.findMany({
      where: { userId, status: "SUCCESSFUL", kind: "P2P", direction: "SENT", occurredAt: { gte: since } },
      orderBy: { occurredAt: "asc" },
      take: 2000,
    }),
  ]);
  const groups = new Map<string, Candidate>();
  const add = (merchantKey: string, amountMinor: number, at: Date, type: string, id: string) => {
    const key = merchantKey;
    const group = groups.get(key) ?? { merchantKey: key, amounts: [], dates: [], refs: [] };
    group.amounts.push(amountMinor);
    group.dates.push(at);
    group.refs.push({ type, id, amountMinor, at });
    groups.set(key, group);
  };
  for (const payment of payments) add(`merchant:${payment.merchantId}`, payment.amountMinor, payment.settledAt ?? payment.createdAt, "MERCHANT_PAYMENT", payment.id);
  for (const transaction of transactions) {
    add(`transfer:${transaction.counterpartyUsername ?? transaction.counterpartyName ?? "unknown"}`, Number(transaction.amountMinor), transaction.occurredAt, "TRANSACTION", transaction.id);
  }

  const created: RecurringPatternView[] = [];
  for (const group of groups.values()) {
    if (group.dates.length < 3) continue;
    const average = Math.round(group.amounts.reduce((sum, amount) => sum + amount, 0) / group.amounts.length);
    if (average <= 0) continue;
    // Amounts must be similar: within ±25% of the average.
    const similar = group.amounts.filter((amount) => Math.abs(amount - average) <= average * 0.25);
    if (similar.length < 3) continue;
    const sorted = [...group.dates].sort((a, b) => a.getTime() - b.getTime());
    const gaps = sorted.slice(1).map((date, index) => date.getTime() - sorted[index]!.getTime());
    const { frequency, intervalCount } = intervalFrequency(gaps);
    const regular = gaps.length > 0 && gaps.every((gap) => Math.abs(gap - gaps[0]!) <= gaps[0]! * 0.35);
    const confidence = similar.length >= 4 && regular ? "HIGH" : similar.length >= 3 ? "MEDIUM" : "LOW";
    const lastSeenAt = sorted[sorted.length - 1]!;
    const nextExpectedAt = new Date(lastSeenAt.getTime() + (frequency === "CUSTOM" ? intervalCount * 86_400_000 : frequency === "WEEKLY" ? 7 * 86_400_000 : frequency === "FORTNIGHTLY" ? 14 * 86_400_000 : frequency === "MONTHLY" ? 30 * 86_400_000 : frequency === "QUARTERLY" ? 90 * 86_400_000 : 365 * 86_400_000));

    const existing = await prisma.recurringExpensePattern.findUnique({
      where: { userId_merchantKey_frequency: { userId, merchantKey: group.merchantKey, frequency } },
    });
    if (existing && existing.status !== "DETECTED") continue;
    const pattern = existing
      ? await prisma.recurringExpensePattern.update({
          where: { id: existing.id },
          data: { amountMinor: average, confidence, lastSeenAt, nextExpectedAt },
        })
      : await prisma.recurringExpensePattern.create({
          data: {
            userId, merchantKey: group.merchantKey, amountMinor: average, currency: "INR",
            frequency, intervalCount, confidence, status: "DETECTED", lastSeenAt, nextExpectedAt,
          },
        });
    for (const ref of group.refs) {
      await prisma.recurringExpenseEvidence.upsert({
        where: { patternId_sourceId: { patternId: pattern.id, sourceId: ref.id } },
        create: { patternId: pattern.id, sourceType: ref.type, sourceId: ref.id, amountMinor: ref.amountMinor, occurredAt: ref.at },
        update: {},
      });
    }
    created.push(toView(pattern, group.refs.length));
  }
  return created;
}

export async function listPatterns(userId: string): Promise<RecurringPatternView[]> {
  const rows = await prisma.recurringExpensePattern.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    include: { _count: { select: { evidence: true } } },
  });
  return rows.map((row) => toView(row, row._count.evidence));
}

async function ownedPattern(userId: string, id: string) {
  const pattern = await prisma.recurringExpensePattern.findFirst({ where: { id, userId } });
  if (!pattern) throw new ApiError(404, "AUTHORIZATION_ERROR", "Recurring pattern not found.");
  return pattern;
}

export async function updatePattern(userId: string, id: string, input: RecurringPatternUpdateInput): Promise<RecurringPatternView> {
  await ownedPattern(userId, id);
  const updated = await prisma.recurringExpensePattern.update({
    where: { id },
    data: {
      merchantKey: input.merchant ?? undefined,
      amountMinor: input.amountMinor ?? undefined,
      frequency: input.frequency ?? undefined,
      status: (input.status as RecurrencePatternStatus) ?? undefined,
    },
  });
  const count = await prisma.recurringExpenseEvidence.count({ where: { patternId: id } });
  return toView(updated, count);
}

export async function confirmPattern(userId: string, id: string): Promise<RecurringPatternView> {
  const pattern = await ownedPattern(userId, id);
  if (pattern.status === "CONFIRMED") return toView(pattern, await prisma.recurringExpenseEvidence.count({ where: { patternId: id } }));
  const updated = await prisma.recurringExpensePattern.update({ where: { id }, data: { status: "CONFIRMED" } });
  return toView(updated, await prisma.recurringExpenseEvidence.count({ where: { patternId: id } }));
}

export async function ignorePattern(userId: string, id: string): Promise<RecurringPatternView> {
  await ownedPattern(userId, id);
  const updated = await prisma.recurringExpensePattern.update({ where: { id }, data: { status: "IGNORED" } });
  return toView(updated, await prisma.recurringExpenseEvidence.count({ where: { patternId: id } }));
}
