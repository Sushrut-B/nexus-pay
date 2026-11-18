import { describe, expect, it } from "vitest";
import { calculateEmi, buildAmortizationSchedule, aprFromRate } from "../../apps/web/lib/credit/calculations";

describe("calculateEmi", () => {
  it("uses reducing-balance formula for standard loans", () => {
    const result = calculateEmi(1_000_000, 1200, 12);
    expect(result.method).toBe("reducing_balance");
    expect(result.emiMinor).toBeGreaterThan(0);
    expect(result.totalRepaymentMinor).toBe(result.emiMinor * 12);
    expect(result.totalInterestMinor).toBe(result.totalRepaymentMinor - 1_000_000);
  });

  it("handles zero-interest loans without computing interest", () => {
    const result = calculateEmi(120_000, 0, 12);
    expect(result.method).toBe("zero_interest");
    expect(result.emiMinor).toBe(10_000);
    expect(result.totalInterestMinor).toBe(0);
  });

  it("handles flat-rate products differently from reducing balance", () => {
    const flat = calculateEmi(1_000_000, 1200, 12, "FLAT");
    const reducing = calculateEmi(1_000_000, 1200, 12);
    expect(flat.method).toBe("flat_rate");
    expect(flat.totalInterestMinor).toBe(120_000);
    expect(flat.emiMinor).not.toBe(reducing.emiMinor);
  });

  it("defers provider-defined products to provider schedules", () => {
    const result = calculateEmi(1_000_000, 1200, 12, "PROVIDER_DEFINED");
    expect(result.method).toBe("provider_defined");
    expect(result.emiMinor).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => calculateEmi(0, 100, 12)).toThrow();
    expect(() => calculateEmi(100, 100, 0)).toThrow();
  });
});

describe("amortization", () => {
  it("fully repays principal across the schedule", () => {
    const emi = calculateEmi(1_000_000, 1200, 12).emiMinor;
    const rows = buildAmortizationSchedule(1_000_000, 1200, 12, emi, new Date("2026-01-01T00:00:00.000Z"));
    expect(rows).toHaveLength(12);
    expect(rows.reduce((sum, row) => sum + row.principalMinor, 0)).toBe(1_000_000);
    expect(rows[0]!.dueDate).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("aprFromRate", () => {
  it("includes fees in a documented approximation", () => {
    expect(aprFromRate(1200, 10_000, 1_000_000, 12)).toBeGreaterThan(1200);
  });
});
