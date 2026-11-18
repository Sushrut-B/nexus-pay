import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint } from "../../apps/web/lib/security/crypto";
import { moneyMovements, type ClassifiedRecord } from "../../apps/web/lib/finance-intelligence/classification-service";

beforeAll(() => {
  process.env.AUTH_SECRET ??= "unit-test-auth-secret-at-least-32-characters";
  process.env.DATABASE_URL ??= "postgresql://nexuspay:test@localhost:5433/nexus_pay";
});

const record = (overrides: Partial<ClassifiedRecord>): ClassifiedRecord => ({
  sourceType: "EXTERNAL_TRANSACTION", sourceId: "x", category: "EXPENSE", direction: "OUT",
  amountMinor: 1000, currency: "INR", occurredAt: new Date(), description: "x",
  merchantName: null, paymentRef: null, isAdjustment: false, classificationSource: "PROVIDER_REPORTED",
  ...overrides,
});

describe("token encryption", () => {
  it("round-trips secrets and never stores plaintext", () => {
    const secret = "provider-token-super-secret-value";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.split(".")).toHaveLength(3);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces distinct ciphertexts for the same secret", () => {
    expect(encryptSecret("same-secret")).not.toBe(encryptSecret("same-secret"));
  });

  it("redacts secrets in hints", () => {
    expect(secretHint("abcdef123456")).toBe("****3456");
  });
});

describe("consolidated money rules", () => {
  it("counts external inflow and outflow only once", () => {
    const result = moneyMovements([
      record({ sourceId: "a", category: "INCOME", direction: "IN", amountMinor: 1_000_000 }),
      record({ sourceId: "b", amountMinor: 300_000 }),
    ]);
    expect(result).toEqual({ inflowMinor: 1_000_000, outflowMinor: 300_000, netMinor: 700_000 });
  });

  it("excludes confirmed internal transfers by source filtering", () => {
    const all = [
      record({ sourceId: "debit", amountMinor: 10_000 }),
      record({ sourceId: "credit", category: "INCOME", direction: "IN", amountMinor: 10_000 }),
    ];
    const excluded = new Set(["debit", "credit"]);
    const result = moneyMovements(all.filter((item) => !excluded.has(item.sourceId)));
    expect(result).toEqual({ inflowMinor: 0, outflowMinor: 0, netMinor: 0 });
  });
});
