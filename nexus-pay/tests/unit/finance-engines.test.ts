import { describe, expect, it } from "vitest";
import {
  resolvePeriod,
  SPENDING_CATEGORY_TYPES,
} from "../../apps/web/lib/finance/analytics-service";
import { computeNextExecution } from "../../apps/web/lib/finance/scheduled-payment-service";
import { resolveRule } from "../../apps/web/lib/finance/category-service";

describe("Release 4 financial calculation engine", () => {
  it("resolves reporting periods deterministically", () => {
    const month = resolvePeriod("month");
    expect(month.start.getUTCDate()).toBe(1);
    expect(month.label).toBe("This month");
    expect(month.previousEnd.getTime()).toBe(month.start.getTime() - 1);

    const lastMonth = resolvePeriod("last_month");
    expect(lastMonth.end.getTime()).toBe(month.start.getTime());
    expect(lastMonth.label).toBe("Last month");

    const custom = resolvePeriod("custom", "2026-01-01", "2026-01-31");
    expect(custom.start.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(custom.end.toISOString().slice(0, 10)).toBe("2026-01-31");
    expect(custom.previousEnd.getTime()).toBe(custom.start.getTime() - 1);
  });

  it("computes next execution dates without float drift", () => {
    const start = new Date("2026-01-15T09:00:00.000Z");
    expect(computeNextExecution(start, "DAILY").toISOString()).toBe("2026-01-16T09:00:00.000Z");
    expect(computeNextExecution(start, "WEEKLY").toISOString()).toBe("2026-01-22T09:00:00.000Z");
    expect(computeNextExecution(start, "MONTHLY").toISOString()).toBe("2026-02-15T09:00:00.000Z");
    expect(computeNextExecution(start, "QUARTERLY").toISOString()).toBe("2026-04-15T09:00:00.000Z");
    expect(computeNextExecution(start, "YEARLY").toISOString()).toBe("2027-01-15T09:00:00.000Z");
    expect(computeNextExecution(start, "ONCE").toISOString()).toBe(start.toISOString());
  });

  it("resolves categorization rules by priority then creation order", () => {
    const rules = [
      { id: "b", conditionType: "CONTAINS" as const, conditionValue: "uber", priority: 50 },
      { id: "a", conditionType: "CONTAINS" as const, conditionValue: "uber", priority: 100 },
      { id: "c", conditionType: "EXACT" as const, conditionValue: "netflix", priority: 100 },
    ];
    expect(resolveRule("Uber ride", rules)).toBe("a");
    expect(resolveRule("NETFLIX", rules)).toBe("c");
    expect(resolveRule("unknown merchant", rules)).toBeNull();
  });

  it("keeps transfers and group obligations out of spending totals", () => {
    expect(SPENDING_CATEGORY_TYPES).toContain("FOOD_DINING");
    expect(SPENDING_CATEGORY_TYPES).toContain("UNCATEGORIZED");
    expect(SPENDING_CATEGORY_TYPES).not.toContain("INCOME");
    expect(SPENDING_CATEGORY_TYPES).not.toContain("PERSONAL_TRANSFERS");
    expect(SPENDING_CATEGORY_TYPES).not.toContain("GROUP_EXPENSES");
  });
});
