import { describe, expect, it } from "vitest";
import { resolveFinancePeriod } from "../../apps/web/lib/finance-intelligence/aggregation-service";
import { moneyMovements, type ClassifiedRecord } from "../../apps/web/lib/finance-intelligence/classification-service";

const record = (overrides: Partial<ClassifiedRecord>): ClassifiedRecord => ({
  sourceType: "TRANSACTION", sourceId: "x", category: "EXPENSE", direction: "OUT",
  amountMinor: 1000, currency: "INR", occurredAt: new Date(), description: "x",
  merchantName: null, paymentRef: null, isAdjustment: false, classificationSource: "RULE",
  ...overrides,
});

describe("resolveFinancePeriod", () => {
  it("uses UTC month boundaries", () => {
    const month = resolveFinancePeriod("month");
    expect(month.from.getUTCDate()).toBe(1);
    expect(month.from.getUTCHours()).toBe(0);
    expect(month.previousTo.getTime()).toBe(month.from.getTime() - 1);
  });

  it("handles last month and custom ranges", () => {
    const last = resolveFinancePeriod("last_month");
    expect(last.from.getTime()).toBeLessThan(last.to.getTime());
    expect(last.from.getUTCDate()).toBe(1);
    expect(last.previousTo.getTime()).toBe(last.from.getTime() - 1);
    const custom = resolveFinancePeriod("custom", "2026-01-01", "2026-01-31");
    expect(custom.label).toBe("Custom range");
    expect(custom.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("moneyMovements", () => {
  it("counts only verified inflow and outflow", () => {
    const result = moneyMovements([
      record({ category: "INCOME", direction: "IN", amountMinor: 1_000_000, sourceId: "income" }),
      record({ category: "EXPENSE", amountMinor: 300_000, sourceId: "expense" }),
      record({ category: "CASHBACK", direction: "IN", amountMinor: 50_000, sourceId: "cashback" }),
    ]);
    expect(result.inflowMinor).toBe(1_050_000);
    expect(result.outflowMinor).toBe(300_000);
    expect(result.netMinor).toBe(750_000);
  });

  it("excludes internal transfers, group settlements and reward points", () => {
    const result = moneyMovements([
      record({ category: "INTERNAL_TRANSFER", direction: "IN", amountMinor: 200_000, sourceId: "internal" }),
      record({ category: "GROUP_SETTLEMENT", direction: "IN", amountMinor: 200_000, sourceId: "group" }),
      record({ category: "REWARD", direction: "NEUTRAL", amountMinor: 0, sourceId: "reward" }),
    ]);
    expect(result).toEqual({ inflowMinor: 0, outflowMinor: 0, netMinor: 0 });
  });

  it("treats refunds as expense adjustments, not new income", () => {
    const result = moneyMovements([
      record({ category: "EXPENSE", amountMinor: 100_000, sourceId: "expense" }),
      record({ category: "REFUND", direction: "IN", amountMinor: 50_000, sourceId: "refund", isAdjustment: true }),
    ]);
    expect(result.inflowMinor).toBe(0);
    expect(result.outflowMinor).toBe(50_000);
    expect(result.netMinor).toBe(-50_000);
  });
});
