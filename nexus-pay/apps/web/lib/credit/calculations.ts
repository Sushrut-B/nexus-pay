import type { InterestRateType } from "@nexus/database";

export interface EmiResult {
  emiMinor: number;
  totalRepaymentMinor: number;
  totalInterestMinor: number;
  method: string;
  assumptions: string[];
}

/**
 * Standard reducing-balance EMI: P × r × (1+r)^n / ((1+r)^n − 1).
 * All inputs are integer paise / basis points; the result is rounded to the
 * nearest paisa. Zero-interest loans are divided evenly with a final adjustment.
 */
export function calculateEmi(
  principalMinor: number,
  annualRateBps: number,
  months: number,
  rateType: InterestRateType = "REDUCING_BALANCE",
): EmiResult {
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0) throw new Error("Principal must be a positive integer in paise");
  if (!Number.isSafeInteger(months) || months <= 0) throw new Error("Tenure must be a positive integer number of months");
  if (!Number.isSafeInteger(annualRateBps) || annualRateBps < 0) throw new Error("Rate must be a non-negative integer in basis points");

  if (rateType === "FLAT") {
    // Flat rate is charged on the original principal for the whole tenure.
    const totalInterest = Math.round((principalMinor * annualRateBps * months) / (10_000 * 12));
    const total = principalMinor + totalInterest;
    return {
      emiMinor: Math.round(total / months),
      totalRepaymentMinor: total,
      totalInterestMinor: totalInterest,
      method: "flat_rate",
      assumptions: ["Interest charged on original principal for full tenure", "Result rounded to nearest paisa"],
    };
  }
  if (rateType === "VARIABLE" || rateType === "PROVIDER_DEFINED") {
    return {
      emiMinor: 0,
      totalRepaymentMinor: 0,
      totalInterestMinor: 0,
      method: "provider_defined",
      assumptions: ["Provider supplies the repayment schedule; no local EMI is inferred"],
    };
  }
  if (annualRateBps === 0) {
    const installment = Math.floor(principalMinor / months);
    return {
      emiMinor: installment,
      totalRepaymentMinor: principalMinor,
      totalInterestMinor: 0,
      method: "zero_interest",
      assumptions: ["No interest applied", "Principal divided evenly with a final adjustment"],
    };
  }
  const monthlyRate = annualRateBps / 1_200_000; // bps → monthly fraction
  const factor = Math.pow(1 + monthlyRate, months);
  const emi = Math.round((principalMinor * monthlyRate * factor) / (factor - 1));
  const total = emi * months;
  return {
    emiMinor: emi,
    totalRepaymentMinor: total,
    totalInterestMinor: Math.max(0, total - principalMinor),
    method: "reducing_balance",
    assumptions: [
      "Rate converted from annual basis points to a monthly fraction",
      "Equal monthly instalments with reducing principal",
      "EMI rounded to nearest paisa; final instalment may adjust",
    ],
  };
}

export interface AmortizationRow {
  installmentNo: number;
  dueDate: string;
  principalMinor: number;
  interestMinor: number;
  totalMinor: number;
}

/** Deterministic reducing-balance amortization with a final balancing instalment. */
export function buildAmortizationSchedule(
  principalMinor: number,
  annualRateBps: number,
  months: number,
  emiMinor: number,
  firstDueDate: Date = new Date(),
): AmortizationRow[] {
  const monthlyRate = annualRateBps / 1_200_000;
  let balance = principalMinor;
  const rows: AmortizationRow[] = [];
  for (let index = 1; index <= months; index += 1) {
    const interest = annualRateBps === 0 ? 0 : Math.round(balance * monthlyRate);
    let principal = emiMinor - interest;
    if (index === months) principal = balance;
    if (principal > balance) principal = balance;
    if (principal < 0) principal = 0;
    const total = principal + interest;
    balance = Math.max(0, balance - principal);
    const due = new Date(firstDueDate);
    due.setUTCMonth(due.getUTCMonth() + index - 1);
    rows.push({
      installmentNo: index,
      dueDate: due.toISOString(),
      principalMinor: principal,
      interestMinor: interest,
      totalMinor: total,
    });
  }
  return rows;
}

export function aprFromRate(annualRateBps: number, feesMinor: number, principalMinor: number, months: number): number | null {
  if (principalMinor <= 0 || months <= 0) return null;
  // Simple documented APR approximation including upfront fees, not a regulatory APR.
  const feeBps = Math.round((feesMinor / principalMinor) * 10_000);
  return annualRateBps + Math.round(feeBps * (12 / months));
}
