import { prisma } from "@nexus/database";
import type {
  RecurringFrequency,
  RecurringSuggestionView,
  ScheduleFrequency,
} from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { createScheduledPayment } from "@/lib/finance/scheduled-payment-service";

interface Occurrence {
  paymentRef: string;
  amountMinor: number;
  occurredAt: Date;
}

const FREQUENCY_DAYS: Record<RecurringFrequency, number> = {
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  YEARLY: 365,
  UNKNOWN: 0,
};

const SCHEDULE_FREQUENCY: Record<RecurringFrequency, ScheduleFrequency> = {
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  YEARLY: "YEARLY",
  UNKNOWN: "MONTHLY",
};

function medianIntervalDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const intervals: number[] = [];
  for (let index = 1; index < dates.length; index += 1) {
    intervals.push((dates[index]!.getTime() - dates[index - 1]!.getTime()) / 86_400_000);
  }
  intervals.sort((a, b) => a - b);
  const middle = intervals[Math.floor(intervals.length / 2)]!;
  return middle;
}

function classifyFrequency(intervalDays: number): RecurringFrequency {
  const candidates: RecurringFrequency[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
  let best: RecurringFrequency = "UNKNOWN";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const delta = Math.abs(intervalDays - FREQUENCY_DAYS[candidate]);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  const tolerance = best === "WEEKLY" ? 2 : best === "MONTHLY" ? 5 : best === "QUARTERLY" ? 12 : 30;
  return bestDelta <= tolerance ? best : "UNKNOWN";
}

function isRegular(intervalDays: number, frequency: RecurringFrequency): boolean {
  const target = FREQUENCY_DAYS[frequency];
  if (!target) return false;
  const tolerance = frequency === "WEEKLY" ? 2 : frequency === "MONTHLY" ? 5 : frequency === "QUARTERLY" ? 12 : 30;
  return Math.abs(intervalDays - target) <= tolerance;
}

/**
 * Recurring detection is a suggestion engine only. It never creates a schedule
 * or changes any financial record.
 */
export async function detectRecurringSuggestions(userId: string): Promise<RecurringSuggestionView[]> {
  const transactions = await prisma.transactionRecord.findMany({
    where: { userId, status: "SUCCESSFUL", kind: "P2P", direction: "SENT", paymentRef: { not: null } },
    orderBy: { occurredAt: "asc" },
    take: 2_000,
  });

  const grouped = new Map<string, Occurrence[]>();
  for (const record of transactions) {
    if (!record.counterpartyUsername) continue;
    const key = `${record.counterpartyUsername}|${record.amountMinor.toString()}`;
    const list = grouped.get(key) ?? [];
    list.push({
      paymentRef: record.paymentRef!,
      amountMinor: Number(record.amountMinor),
      occurredAt: record.occurredAt,
    });
    grouped.set(key, list);
  }

  for (const [key, occurrences] of grouped) {
    if (occurrences.length < 2) continue;
    const [counterpartyUsername, amountString] = key.split("|");
    const amountMinor = Number(amountString);
    const interval = medianIntervalDays(occurrences.map((o) => o.occurredAt));
    const frequency = interval ? classifyFrequency(interval) : "UNKNOWN";
    const regular = interval !== null && isRegular(interval, frequency);
    const lastObserved = occurrences[occurrences.length - 1]!.occurredAt;
    const nextExpected =
      interval !== null && frequency !== "UNKNOWN" ? new Date(lastObserved.getTime() + interval * 86_400_000) : null;
    const confidence = Math.min(
      100,
      occurrences.length * 20 + (regular ? 20 : 0),
    );
    const counterpartyName = transactions.find((t) => t.counterpartyUsername === counterpartyUsername)?.counterpartyName ?? counterpartyUsername!;

    await prisma.recurringPaymentSuggestion.upsert({
      where: {
        userId_counterpartyUsername_amountMinor: {
          userId,
          counterpartyUsername: counterpartyUsername!,
          amountMinor: BigInt(amountMinor),
        },
      },
      create: {
        userId,
        counterparty: counterpartyName ?? counterpartyUsername!,
        counterpartyUsername: counterpartyUsername!,
        amountMinor: BigInt(amountMinor),
        currency: "INR",
        suggestedFrequency: frequency,
        lastObservedAt: lastObserved,
        nextExpectedAt: nextExpected,
        confidence,
        status: "SUGGESTED",
      },
      update: {
        counterparty: counterpartyName ?? counterpartyUsername!,
        suggestedFrequency: frequency,
        lastObservedAt: lastObserved,
        nextExpectedAt: nextExpected,
        confidence,
      },
    });
  }

  return listSuggestions(userId);
}

export async function listSuggestions(userId: string): Promise<RecurringSuggestionView[]> {
  const suggestions = await prisma.recurringPaymentSuggestion.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { confidence: "desc" }, { lastObservedAt: "desc" }],
  });
  return suggestions.map((suggestion) => ({
    id: suggestion.id,
    counterparty: suggestion.counterparty,
    counterpartyUsername: suggestion.counterpartyUsername,
    amountMinor: Number(suggestion.amountMinor),
    currency: suggestion.currency,
    suggestedFrequency: suggestion.suggestedFrequency,
    lastObservedAt: suggestion.lastObservedAt.toISOString(),
    nextExpectedAt: suggestion.nextExpectedAt?.toISOString() ?? null,
    confidence: suggestion.confidence,
    status: suggestion.status,
    explanation:
      suggestion.suggestedFrequency === "UNKNOWN"
        ? `Paid ${suggestion.counterparty} the same amount ${suggestion.confidence / 20 >= 2 ? "several times" : "more than once"}, but the interval was not regular enough to estimate a frequency.`
        : `Paid ${suggestion.counterparty} the same amount on a ${suggestion.suggestedFrequency.toLowerCase()} pattern.`,
  }));
}

export async function confirmSuggestion(
  userId: string,
  suggestionId: string,
): Promise<{ scheduleId: string }> {
  const suggestion = await prisma.recurringPaymentSuggestion.findFirst({
    where: { id: suggestionId, userId },
  });
  if (!suggestion) throw new ApiError(404, "AUTHORIZATION_ERROR", "That suggestion could not be found.");
  if (!suggestion.counterpartyUsername) {
    throw new ApiError(409, "PAYMENT_ERROR", "This suggestion has no usable recipient handle.");
  }

  const schedule = await createScheduledPayment(userId, {
    recipientQuery: suggestion.counterpartyUsername,
    amountMinor: Number(suggestion.amountMinor),
    currency: "INR",
    description: `Recurring payment to ${suggestion.counterparty}`,
    frequency: SCHEDULE_FREQUENCY[suggestion.suggestedFrequency],
    startDate: suggestion.nextExpectedAt && suggestion.nextExpectedAt > new Date()
      ? suggestion.nextExpectedAt.toISOString()
      : new Date().toISOString(),
  });

  await prisma.recurringPaymentSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "CONFIRMED" },
  });
  return { scheduleId: schedule.id };
}

export async function ignoreSuggestion(userId: string, suggestionId: string): Promise<void> {
  const suggestion = await prisma.recurringPaymentSuggestion.findFirst({ where: { id: suggestionId, userId } });
  if (!suggestion) throw new ApiError(404, "AUTHORIZATION_ERROR", "That suggestion could not be found.");
  await prisma.recurringPaymentSuggestion.update({ where: { id: suggestion.id }, data: { status: "IGNORED" } });
}
