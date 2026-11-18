import { describe, expect, it } from "vitest";
import { cashbackAmountMinor } from "../../apps/web/lib/rewards/cashback-service";
import { stableUuid } from "../../apps/web/lib/rewards/reward-core";

describe("cashbackAmountMinor", () => {
  it("calculates percentage cashback with a cap using integer paise", () => {
    expect(cashbackAmountMinor(150_000, 1000, 10_000)).toBe(10_000);
    expect(cashbackAmountMinor(50_000, 1000, 10_000)).toBe(5_000);
    expect(cashbackAmountMinor(50_000, 0, 10_000)).toBe(0);
    expect(cashbackAmountMinor(10_001, 1000, 10_000)).toBe(1_000);
  });
});

describe("stableUuid", () => {
  it("is deterministic and UUID-shaped", () => {
    const a = stableUuid("r8cashback:ref:campaign");
    const b = stableUuid("r8cashback:ref:campaign");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuid("other")).not.toBe(a);
  });
});
