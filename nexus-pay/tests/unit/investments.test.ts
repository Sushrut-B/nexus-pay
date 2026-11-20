import { describe, expect, it } from "vitest";
import { calculateSipProjection } from "../../apps/web/lib/investments/planning-service";
import { SandboxInvestmentAdapter, SANDBOX_INVESTMENTS_NOTICE } from "../../apps/web/lib/investments/providers/sandbox-investments";

describe("SIP projection (hypothetical only)", () => {
  it("computes invested amount and returns with integer minor units", () => {
    const result = calculateSipProjection({ monthlyMinor: 10_000_00, months: 12, assumedReturnBps: 0, frequency: "MONTHLY" });
    expect(result.totalInvestedMinor).toBe(120_000_00);
    expect(result.estimatedReturnsMinor).toBe(0);
    expect(result.estimatedMaturityMinor).toBe(120_000_00);
    expect(result.years).toHaveLength(1);
  });

  it("produces a positive estimate at a positive assumed return", () => {
    const result = calculateSipProjection({ monthlyMinor: 10_000_00, months: 60, assumedReturnBps: 700, frequency: "MONTHLY" });
    expect(result.estimatedMaturityMinor).toBeGreaterThan(result.totalInvestedMinor);
    expect(result.estimatedReturnsMinor).toBeGreaterThan(0);
    expect(result.years.length).toBe(5);
  });

  it("never presents the projection as guaranteed", () => {
    const result = calculateSipProjection({ monthlyMinor: 5_000_00, months: 12, assumedReturnBps: 500, frequency: "MONTHLY" });
    expect(result.notice.toLowerCase()).toContain("not guaranteed");
    expect(result.notice.toLowerCase()).toContain("not an sip mandate");
  });

  it("handles annual frequency and rounding", () => {
    const result = calculateSipProjection({ monthlyMinor: 10_000_00, months: 24, assumedReturnBps: 0, frequency: "ANNUAL" });
    expect(result.totalInvestedMinor).toBe(240_000_00);
    expect(Number.isInteger(result.estimatedMaturityMinor)).toBe(true);
  });
});

describe("sandbox investment provider", () => {
  const adapter = new SandboxInvestmentAdapter();

  it("is clearly labelled and claims no regulatory status", () => {
    expect(adapter.mode).toBe("SANDBOX");
    expect(adapter.code).toBe("sandbox-investments");
    expect(SANDBOX_INVESTMENTS_NOTICE.toLowerCase()).toContain("no sebi/amfi registration");
    expect(SANDBOX_INVESTMENTS_NOTICE.toLowerCase()).toContain("not real investments");
    expect(adapter.capabilities.documents).toBe(false);
  });

  it("returns attributed holdings with integer minor units", async () => {
    const accounts = await adapter.discoverAccounts({ userId: "user-1" });
    const holdings = await adapter.getHoldings(accounts[0]!.providerRef);
    expect(holdings.length).toBeGreaterThan(0);
    expect(holdings.every((h) => Number.isInteger(h.valueMinor))).toBe(true);
    expect(holdings.every((h) => h.providerReportedAt instanceof Date)).toBe(true);
  });

  it("provides provider-backed fund and instrument fixtures", async () => {
    const funds = await adapter.listFunds();
    expect(funds.length).toBeGreaterThan(0);
    expect(funds.every((f) => f.code && f.amc && f.retrievedAt)).toBe(true);
    const instruments = await adapter.searchInstruments("SBN");
    expect(instruments.length).toBeGreaterThan(0);
    expect(instruments.every((i) => ["LIVE", "DELAYED", "EOD", "SANDBOX"].includes(i.feedType))).toBe(true);
  });

  it("returns labelled SIP tracking data only", async () => {
    const sips = await adapter.listSips();
    expect(sips.length).toBeGreaterThan(0);
    expect(sips[0]!.schemeName).toContain("fixture");
  });
});
