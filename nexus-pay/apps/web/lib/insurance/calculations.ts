/** Release 12 — pure insurance calculations. All money is integer minor units. */

export interface PremiumInstallment {
  installmentNo: number;
  dueDate: string;
  amountMinor: number;
}

const MONTHS: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/** Builds a deterministic provider-agnostic premium schedule in minor units. */
export function buildPremiumSchedule(input: {
  startDate: Date;
  endDate: Date;
  amountMinor: number;
  frequency: string;
}): PremiumInstallment[] {
  const step = MONTHS[input.frequency];
  if (!step || input.amountMinor <= 0 || input.endDate <= input.startDate) return [];
  const rows: PremiumInstallment[] = [];
  let no = 1;
  let cursor = new Date(input.startDate);
  while (cursor < input.endDate && rows.length < 240) {
    rows.push({ installmentNo: no, dueDate: cursor.toISOString(), amountMinor: input.amountMinor });
    cursor = addMonths(cursor, step);
    no += 1;
  }
  return rows;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Date on which a renewal reminder should be triggered, before expiry. */
export function renewalReminderDate(endDate: Date, noticeDays = 30): string {
  const result = new Date(endDate);
  result.setUTCDate(result.getUTCDate() - noticeDays);
  return result.toISOString();
}

/** Masks a provider policy number; never returns the full value to the browser. */
export function maskPolicyNumber(policyNumber: string): string {
  const trimmed = policyNumber.trim();
  if (trimmed.length <= 4) return "XXXX";
  return `${trimmed.slice(0, 2)}-XXXX-${trimmed.slice(-4)}`;
}

/** Pure expiry check for a provider quote validity window. */
export function isQuoteExpired(validUntil: Date | null, now = new Date()): boolean {
  return validUntil === null || validUntil <= now;
}

/** Sum of a schedule — useful for verification, never used to infer coverage. */
export function scheduleTotalMinor(rows: PremiumInstallment[]): number {
  return rows.reduce((sum, row) => sum + row.amountMinor, 0);
}
