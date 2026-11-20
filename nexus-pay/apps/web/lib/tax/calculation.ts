import type { TaxCalculationView, TaxRegime } from "@nexus/shared-types";
import type { TaxRuleConfig } from "@/lib/tax/tax-rules";
import { getRuleConfig } from "@/lib/tax/tax-rules";

export interface TaxCalculationInput {
  salaryMinor: number;
  otherIncomeMinor: number;
  housePropertyMinor: number;
  deductionsMinor: number;
  specialRateIncomeMinor: number;
  creditsMinor: number;
  resident?: boolean;
}

export interface TaxLineItem { code: string; label: string; amountMinor: number; detail: string | null }
export interface TaxCalculationResult {
  regime: TaxRegime;
  ruleSetVersion: string;
  grossMinor: number;
  taxableMinor: number;
  taxBeforeCreditsMinor: number;
  rebateMinor: number;
  surchargeMinor: number;
  cessMinor: number;
  creditsMinor: number;
  netTaxMinor: number;
  lineItems: TaxLineItem[];
  assumptions: string[];
}

/** Pure slab computation with integer paise and basis-point rates. */
export function computeSlabTax(taxableMinor: number, config: TaxRuleConfig): number {
  let tax = 0;
  for (const slab of config.slabs) {
    if (taxableMinor <= slab.fromMinor) break;
    const upper = slab.toMinor ?? Infinity;
    const amountInSlab = Math.min(taxableMinor, upper) - slab.fromMinor;
    if (amountInSlab <= 0) continue;
    const base = slab.baseTaxMinor > 0 && taxableMinor >= upper ? slab.baseTaxMinor : 0;
    tax = Math.max(tax, base) + Math.round((amountInSlab * slab.rateBps) / 10_000);
  }
  return Math.max(0, tax);
}

function computeSurcharge(taxableMinor: number, taxBeforeSurchargeMinor: number, config: TaxRuleConfig): number {
  let applicable: { incomeAboveMinor: number; rateBps: number } | null = null;
  for (const entry of config.surcharge) {
    if (taxableMinor > entry.incomeAboveMinor) applicable = entry;
  }
  if (!applicable) return 0;
  const raw = Math.round((taxBeforeSurchargeMinor * applicable.rateBps) / 10_000);
  // Marginal relief: tax + surcharge cannot exceed tax at the lower threshold plus the income above it.
  const taxAtThreshold = computeSlabTax(applicable.incomeAboveMinor, config);
  const allowedTotal = taxAtThreshold + (taxableMinor - applicable.incomeAboveMinor);
  return Math.max(0, Math.min(raw, allowedTotal - taxBeforeSurchargeMinor));
}

/** Versioned estimate for one regime. Never an assessed tax liability. */
export function calculateTax(input: TaxCalculationInput, config: TaxRuleConfig): TaxCalculationResult {
  const lineItems: TaxLineItem[] = [];
  const assumptions: string[] = [];
  const grossMinor = input.salaryMinor + input.otherIncomeMinor + input.housePropertyMinor + input.specialRateIncomeMinor;
  const standardDeduction = input.salaryMinor > 0 ? Math.min(config.standardDeductionMinor, input.salaryMinor) : 0;
  const ordinaryIncome = Math.max(0, grossMinor - input.specialRateIncomeMinor);
  const taxableMinor = Math.max(0, ordinaryIncome - standardDeduction - input.deductionsMinor) + input.specialRateIncomeMinor;

  lineItems.push({ code: "GROSS", label: "Gross income", amountMinor: grossMinor, detail: "Salary + other + house property + special-rate income" });
  if (standardDeduction > 0) lineItems.push({ code: "STD_DEDUCTION", label: "Standard deduction", amountMinor: -standardDeduction, detail: "Section 16(ia) / 115BAC" });
  if (input.deductionsMinor > 0) lineItems.push({ code: "DEDUCTIONS", label: "Eligible deductions", amountMinor: -input.deductionsMinor, detail: "User-declared and included in estimate" });
  lineItems.push({ code: "TAXABLE", label: "Estimated taxable income", amountMinor: taxableMinor, detail: `Rule set ${config.version}` });

  let tax = computeSlabTax(Math.max(0, taxableMinor - input.specialRateIncomeMinor), config);
  const specialTax = Math.round((input.specialRateIncomeMinor * config.specialRateBps) / 10_000);
  tax += specialTax;
  if (specialTax > 0) {
    lineItems.push({ code: "SPECIAL_RATE", label: "Special-rate income tax", amountMinor: specialTax, detail: `${config.specialRateBps / 100}% on specially treated income` });
    assumptions.push("Special-rate income is taxed separately at the configured rate; surcharge on such income is capped by applicable rules.");
  }
  lineItems.push({ code: "TAX_BEFORE_REBATE", label: "Income tax before rebate", amountMinor: tax, detail: `${config.regime} regime slabs` });

  const resident = input.resident !== false;
  let rebate = 0;
  if (resident && taxableMinor <= config.rebate.incomeThresholdMinor) {
    rebate = Math.min(tax, config.rebate.maxMinor);
  } else if (resident && config.rebate.marginalRelief && taxableMinor > config.rebate.incomeThresholdMinor) {
    const excess = taxableMinor - config.rebate.incomeThresholdMinor;
    if (tax > excess) rebate = Math.min(config.rebate.maxMinor, tax - excess);
    assumptions.push("Rebate marginal relief applied where tax exceeded income above the rebate threshold.");
  }
  if (rebate > 0) lineItems.push({ code: "REBATE", label: "Rebate under section 87A", amountMinor: -rebate, detail: "Subject to the configured maximum and threshold" });

  const taxAfterRebate = Math.max(0, tax - rebate);
  const surcharge = computeSurcharge(taxableMinor, taxAfterRebate, config);
  if (surcharge > 0) lineItems.push({ code: "SURCHARGE", label: "Surcharge", amountMinor: surcharge, detail: "With marginal relief where applicable" });
  const cess = Math.round(((taxAfterRebate + surcharge) * config.cessBps) / 10_000);
  lineItems.push({ code: "CESS", label: "Health and education cess", amountMinor: cess, detail: `${config.cessBps / 100}% of tax plus surcharge` });

  const taxBeforeCredits = taxAfterRebate + surcharge + cess;
  const credits = Math.min(input.creditsMinor, taxBeforeCredits);
  if (credits > 0) lineItems.push({ code: "CREDITS", label: "Verified TDS/TCS and advance tax credits", amountMinor: -credits, detail: "Only verified credits are subtracted" });
  const netTax = Math.max(0, taxBeforeCredits - credits);

  assumptions.push("This is a Nexus Pay-generated estimate, not an assessed tax liability or professional tax advice.");
  assumptions.push(`Rule set: ${config.version}, sourced ${config.sourceRef.slice(0, 160)}`);
  return {
    regime: config.regime, ruleSetVersion: config.version, grossMinor, taxableMinor,
    taxBeforeCreditsMinor: taxBeforeCredits, rebateMinor: rebate, surchargeMinor: surcharge,
    cessMinor: cess, creditsMinor: credits, netTaxMinor: netTax, lineItems, assumptions,
  };
}

export function compareRegimes(input: TaxCalculationInput, financialYear: string) {
  const oldResult = calculateTax(input, getRuleConfig(financialYear, "OLD"));
  const newResult = calculateTax(input, getRuleConfig(financialYear, "NEW"));
  const materialDrivers: string[] = [];
  if (input.deductionsMinor > 0) materialDrivers.push("Eligible deductions apply only under the old regime for most categories.");
  if (input.salaryMinor > 0) materialDrivers.push("Standard deduction differs between regimes.");
  if (oldResult.netTaxMinor !== newResult.netTaxMinor) {
    materialDrivers.push(`Estimated difference: ₹${(Math.abs(oldResult.netTaxMinor - newResult.netTaxMinor) / 100).toLocaleString("en-IN")}.`);
  }
  return {
    old: oldResult, new: newResult,
    differenceMinor: oldResult.netTaxMinor - newResult.netTaxMinor,
    materialDrivers,
    notice: "Comparison uses the same inputs and versioned rules. No regime is automatically recommended; consult a qualified tax professional for complex cases.",
  };
}

export function toCalculationView(id: string, financialYear: string, result: TaxCalculationResult): TaxCalculationView {
  return {
    id, financialYear, regime: result.regime, ruleSetVersion: result.ruleSetVersion,
    status: "COMPLETED", grossMinor: result.grossMinor, taxableMinor: result.taxableMinor,
    taxBeforeCreditsMinor: result.taxBeforeCreditsMinor, rebateMinor: result.rebateMinor,
    surchargeMinor: result.surchargeMinor, cessMinor: result.cessMinor,
    creditsMinor: result.creditsMinor, netTaxMinor: result.netTaxMinor,
    assumptions: result.assumptions, lineItems: result.lineItems, createdAt: new Date().toISOString(),
  };
}
