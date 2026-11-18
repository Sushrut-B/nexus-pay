import { describe, expect, it } from "vitest";
import { addBillingInterval, frequencyLabel, normalizeToMonthly } from "../../apps/web/lib/subscription/billing-calendar";

const date = (value: string) => new Date(`${value}T10:30:00.000Z`);
const day = (value: Date) => value.toISOString().slice(0, 10);

describe("addBillingInterval", () => {
  it("clamps month-end dates deterministically without re-anchoring", () => {
    const jan31 = date("2026-01-31");
    const feb = addBillingInterval(jan31, "MONTHLY", 1);
    expect(day(feb)).toBe("2026-02-28");
    const mar = addBillingInterval(feb, "MONTHLY", 1);
    expect(day(mar)).toBe("2026-03-28");
  });

  it("clamps a 31st to a 30-day month", () => {
    expect(day(addBillingInterval(date("2026-03-31"), "MONTHLY", 1))).toBe("2026-04-30");
  });

  it("preserves the time of day across a clamped month", () => {
    expect(addBillingInterval(date("2026-01-31"), "MONTHLY", 1).toISOString()).toBe("2026-02-28T10:30:00.000Z");
  });

  it("handles quarterly and yearly anchors including leap day", () => {
    expect(day(addBillingInterval(date("2026-01-31"), "QUARTERLY", 1))).toBe("2026-04-30");
    expect(day(addBillingInterval(date("2024-02-29"), "YEARLY", 1))).toBe("2025-02-28");
    expect(day(addBillingInterval(date("2026-02-28"), "YEARLY", 1))).toBe("2027-02-28");
  });

  it("supports daily, weekly, custom and multi-count intervals", () => {
    expect(day(addBillingInterval(date("2026-01-01"), "DAILY", 3))).toBe("2026-01-04");
    expect(day(addBillingInterval(date("2026-01-01"), "WEEKLY", 2))).toBe("2026-01-15");
    expect(day(addBillingInterval(date("2026-01-01"), "CUSTOM", 10))).toBe("2026-01-11");
    expect(day(addBillingInterval(date("2026-01-01"), "MONTHLY", 3))).toBe("2026-04-01");
  });
});

describe("normalizeToMonthly", () => {
  it("normalizes recurring amounts to integer monthly paise", () => {
    expect(normalizeToMonthly(30_000, "MONTHLY", 1)).toBe(30_000);
    expect(normalizeToMonthly(90_000, "QUARTERLY", 1)).toBe(30_000);
    expect(normalizeToMonthly(600_000, "YEARLY", 1)).toBe(50_000);
    expect(normalizeToMonthly(2_000, "WEEKLY", 1)).toBe(Math.round((2_000 * 52) / 12));
    expect(normalizeToMonthly(100, "DAILY", 1)).toBe(Math.round((100 * 365) / 12));
  });

  it("respects a multi-period interval", () => {
    expect(normalizeToMonthly(180_000, "QUARTERLY", 2)).toBe(30_000);
  });
});

describe("frequencyLabel", () => {
  it("produces human-readable labels", () => {
    expect(frequencyLabel("MONTHLY", 1)).toBe("every month");
    expect(frequencyLabel("MONTHLY", 3)).toBe("every 3 months");
    expect(frequencyLabel("YEARLY", 1)).toBe("every year");
  });
});
