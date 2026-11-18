import type { BillingFrequency } from "@nexus/shared-types";

/**
 * Recurring date arithmetic. All calculations are performed in UTC so they are
 * independent of the server's local timezone. Subscriptions store an explicit
 * billing timezone (Asia/Kolkata by default); for the sandbox the anchor date
 * is interpreted in UTC and no daylight-saving shift is applied.
 *
 * End-of-month policy: the next billing day is the same day-of-month as the
 * previous occurrence, clamped to the last valid day of the target month.
 * Examples: Jan 31 -> Feb 28 -> Mar 28; Mar 31 -> Apr 30; Feb 28 -> Mar 28.
 * This is deterministic and never re-anchors to the original start date.
 */
export function addBillingInterval(from: Date, frequency: BillingFrequency, intervalCount: number): Date {
  const count = Math.max(1, Math.floor(intervalCount));
  const next = new Date(from.getTime());

  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + count);
      break;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + count * 7);
      break;
    case "MONTHLY":
      return addMonthsClamped(from, count);
    case "QUARTERLY":
      return addMonthsClamped(from, count * 3);
    case "YEARLY":
      return addMonthsClamped(from, count * 12);
    case "CUSTOM":
      // A custom interval is a validated integer number of days.
      next.setUTCDate(next.getUTCDate() + count);
      break;
    default:
      throw new Error(`Unsupported billing frequency: ${String(frequency)}`);
  }
  return next;
}

function addMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, lastDayOfTarget));
  firstOfTarget.setUTCHours(
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  );
  return firstOfTarget;
}

export function frequencyLabel(frequency: BillingFrequency, intervalCount: number): string {
  const count = Math.max(1, Math.floor(intervalCount));
  const unit: Record<BillingFrequency, string> = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    QUARTERLY: "quarter",
    YEARLY: "year",
    CUSTOM: "day",
  };
  return count === 1 ? `every ${unit[frequency]}` : `every ${count} ${unit[frequency]}s`;
}

/** Normalize a recurring amount to a monthly equivalent for MRR (integer paise). */
export function normalizeToMonthly(amountMinor: number, frequency: BillingFrequency, intervalCount: number): number {
  const count = Math.max(1, Math.floor(intervalCount));
  switch (frequency) {
    case "DAILY":
      return Math.round((amountMinor * 365) / 12 / count);
    case "WEEKLY":
      return Math.round((amountMinor * 52) / 12 / count);
    case "MONTHLY":
      return Math.round(amountMinor / count);
    case "QUARTERLY":
      return Math.round(amountMinor / (3 * count));
    case "YEARLY":
      return Math.round(amountMinor / (12 * count));
    case "CUSTOM":
      return Math.round((amountMinor * 365) / 12 / count);
    default:
      return amountMinor;
  }
}
