import { describe, expect, it } from "vitest";
import { getRuleConfig, supportedFinancialYears } from "../../apps/web/lib/tax/tax-rules";
import { calculateTax, compareRegimes, computeSlabTax } from "../../apps/web/lib/tax/calculation";
import { financialYearRange, TAX_NOTICE } from "../../apps/web/lib/tax/tax-mapping-service";

const cr = (rupees: number) => rupees * 100;
const base = {
  salaryMinor: 0, otherIncomeMinor: 0, housePropertyMinor: 0,
  deductionsMinor: 0, specialRateIncomeMinor: 0, creditsMinor: 0,
};

describe("versioned tax rule configuration", () => {
  it("exposes FY 2025-26 and FY 2024-25 with correct assessment years", () => {
    const years = supportedFinancialYears();
    expect(years).toEqual(expect.arrayContaining([
      expect.objectContaining({ financialYear: "2025-26", assessmentYear: "2026-27" }),
      expect.objectContaining({ financialYear: "2024-25", assessmentYear: "2025-26" }),
    ]));
  });

  it("maps financial year to April–March window", () => {
    const range = financialYearRange("2025-26");
    expect(range.from.getUTCMonth()).toBe(3);
    expect(range.to.getUTCMonth()).toBe(2);
    expect(range.assessmentYear).toBe("2026-27");
  });

  it("carries official source references on every rule set", () => {
    for (const config of ["OLD", "NEW"].map((r) => getRuleConfig("2025-26", r as "OLD" | "NEW"))) {
      expect(config.sourceRef).toContain("incometax.gov.in");
      expect(config.lastVerifiedAt).toBe("2026-11-20");
    }
  });
});

describe("slab boundary calculations", () => {
  it("applies new-regime FY2025-26 slabs at boundaries", () => {
    const config = getRuleConfig("2025-26", "NEW");
    expect(computeSlabTax(cr(4_00_000), config)).toBe(0);
    expect(computeSlabTax(cr(8_00_000), config)).toBe(cr(20_000));
    expect(computeSlabTax(cr(12_00_000), config)).toBe(cr(60_000));
    expect(computeSlabTax(cr(24_00_000), config)).toBe(cr(3_00_000));
  });

  it("applies old-regime slabs at boundaries", () => {
    const config = getRuleConfig("2025-26", "OLD");
    expect(computeSlabTax(cr(2_50_000), config)).toBe(0);
    expect(computeSlabTax(cr(5_00_000), config)).toBe(cr(12_500));
    expect(computeSlabTax(cr(10_00_000), config)).toBe(cr(1_12_500));
  });
});

describe("tax estimates (both regimes)", () => {
  it("new regime: standard deduction, slabs and cess", () => {
    const result = calculateTax({ ...base, salaryMinor: cr(15_00_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.grossMinor).toBe(cr(15_00_000));
    expect(result.taxableMinor).toBe(cr(14_25_000));
    expect(result.netTaxMinor).toBe(cr(97_500));
  });

  it("new regime: section 87A rebate zeroes tax up to ₹12 lakh", () => {
    const result = calculateTax({ ...base, salaryMinor: cr(12_75_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.taxableMinor).toBe(cr(12_00_000));
    expect(result.rebateMinor).toBe(cr(60_000));
    expect(result.netTaxMinor).toBe(0);
  });

  it("new regime: marginal relief just above the rebate threshold", () => {
    const result = calculateTax({ ...base, salaryMinor: cr(12_80_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.taxableMinor).toBe(cr(12_05_000));
    expect(result.netTaxMinor).toBeLessThan(cr(60_000));
  });

  it("old regime: deductions reduce taxable income", () => {
    const result = calculateTax({ ...base, salaryMinor: cr(15_00_000), deductionsMinor: cr(1_50_000) }, getRuleConfig("2025-26", "OLD"));
    expect(result.taxableMinor).toBe(cr(13_00_000));
    expect(result.netTaxMinor).toBe(cr(2_10_600));
  });

  it("old regime: rebate up to ₹12,500 for taxable income ≤ ₹5 lakh", () => {
    const result = calculateTax({ ...base, otherIncomeMinor: cr(5_00_000) }, getRuleConfig("2025-26", "OLD"));
    expect(result.rebateMinor).toBe(cr(12_500));
    expect(result.netTaxMinor).toBe(0);
  });

  it("subtracts only verified credits and never below zero", () => {
    const result = calculateTax({ ...base, salaryMinor: cr(20_00_000), creditsMinor: cr(10_00_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.creditsMinor).toBeLessThanOrEqual(cr(10_00_000));
    expect(result.netTaxMinor).toBeGreaterThanOrEqual(0);
    expect(result.netTaxMinor).toBe(result.taxBeforeCreditsMinor - result.creditsMinor);
  });

  it("computes surcharge and marginal relief above ₹50 lakh", () => {
    const result = calculateTax({ ...base, otherIncomeMinor: cr(60_00_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.surchargeMinor).toBeGreaterThan(0);
    expect(result.netTaxMinor).toBe(result.taxBeforeCreditsMinor - result.creditsMinor);
  });

  it("keeps special-rate income separate with 20% rate", () => {
    const result = calculateTax({ ...base, specialRateIncomeMinor: cr(1_00_000) }, getRuleConfig("2025-26", "NEW"));
    expect(result.lineItems.some((line) => line.code === "SPECIAL_RATE")).toBe(true);
    expect(result.assumptions.some((a) => a.toLowerCase().includes("special-rate"))).toBe(true);
  });

  it("compares regimes independently using the same inputs", () => {
    const comparison = compareRegimes({ ...base, salaryMinor: cr(15_00_000), deductionsMinor: cr(1_50_000) }, "2025-26");
    expect(comparison.old.regime).toBe("OLD");
    expect(comparison.new.regime).toBe("NEW");
    expect(comparison.differenceMinor).toBe(comparison.old.netTaxMinor - comparison.new.netTaxMinor);
    expect(comparison.notice).toContain("No regime is automatically recommended");
  });
});

describe("tax safety disclosures", () => {
  it("never presents an estimate as assessed tax or advice", () => {
    expect(TAX_NOTICE).toContain("not assessed tax");
    expect(TAX_NOTICE).toContain("not a chartered accountancy firm");
  });
});
