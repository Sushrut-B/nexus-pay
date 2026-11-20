import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r17_${stamp}_${label}`,
      fullName: `Release Seventeen ${label}`,
      email: `r17_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r17${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Seventeen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  const accountId = `np_r17_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release17-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return user;
}

const baseInput = {
  salaryMinor: 15_00_000_00,
  otherIncomeMinor: 0,
  housePropertyMinor: 0,
  deductionsMinor: 1_50_000_00,
  specialRateIncomeMinor: 0,
  creditsMinor: 0,
};

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    rules: await import("../../apps/web/lib/tax/tax-rules"),
    calculation: await import("../../apps/web/lib/tax/calculation"),
    mapping: await import("../../apps/web/lib/tax/tax-mapping-service"),
    tax: await import("../../apps/web/lib/tax/tax-service"),
    documents: await import("../../apps/web/lib/tax/tax-document-service"),
    finance: await import("../../apps/web/lib/finance-intelligence/classification-service"),
    control: await import("../../apps/web/lib/tax/tax-control-service"),
    bootstrap: await import("../../apps/web/lib/tax/tax-worker-bootstrap"),
  };
  await svc.bootstrap.ensureTaxConfiguration();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r17_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 17 tax verification", () => {
  it("TAX-01: versioned rule sets are seeded from official sources", async () => {
    expect(await prisma.taxRuleSet.count({ where: { status: "PUBLISHED" } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.taxDeadline.count()).toBeGreaterThan(0);
    const rules = await svc.rules.getRuleConfig("2025-26", "NEW");
    expect(rules.sourceRef).toContain("incometax.gov.in");
  }, 120_000);

  it("FY-02: financial year and assessment year stay distinct", async () => {
    const user = await createUser("fy");
    const result = await svc.tax.ensureFinancialYear(user.id, "2025-26");
    expect(result.financialYear).toBe("2025-26");
    expect(result.assessmentYear).toBe("2026-27");
    await expectApiError(svc.tax.ensureFinancialYear(user.id, "2099-00"), 400);
  }, 120_000);

  it("INC-03: consolidation reuses the canonical aggregation engine without double counting", async () => {
    const user = await createUser("income");
    const range = svc.mapping.financialYearRange("2025-26");
    const canonical = await svc.finance.loadClassifiedTransactions(user.id, range.from, range.to, { includeExternal: true });
    const result = await svc.mapping.consolidateIncome(user.id, "2025-26");
    expect(result.totalInflowMinor).toBe(svc.finance.moneyMovements(canonical.records).inflowMinor);
    expect(result.notice).toContain("No wallet transfer is automatically income");
  }, 120_000);

  it("INC-04: income classification can be reviewed and confirmed", async () => {
    const user = await createUser("classify");
    const created = await svc.mapping.createIncome(user.id, {
      financialYear: "2025-26", category: "USER_DECLARED", description: "Test freelance receipt",
      amountMinor: 50_000_00, occurredAt: "2025-08-15T00:00:00.000Z",
    });
    expect(created.classification).toBe("POTENTIALLY_TAXABLE");
    const updated = await svc.mapping.updateIncome(user.id, created.id, { userConfirmed: true });
    expect(updated.classification).toBe("USER_CONFIRMED");
    expect(updated.userConfirmed).toBe(true);
  }, 120_000);

  it("CALC-05: both regimes are calculated with versioned rules and persisted", async () => {
    const user = await createUser("calc");
    const comparison = await svc.tax.compareAndStore(user.id, "2025-26", baseInput);
    expect(comparison.old.ruleSetVersion).toBe("ITD-FY2025-26-v1");
    expect(comparison.new.ruleSetVersion).toBe("ITD-FY2025-26-v1");
    expect(comparison.new.netTaxMinor).toBeGreaterThan(0);
    expect(comparison.differenceMinor).toBe(comparison.old.netTaxMinor - comparison.new.netTaxMinor);
    const stored = await svc.tax.listCalculations(user.id, "2025-26");
    expect(stored.length).toBe(2);
    const detail = await svc.tax.getCalculation(user.id, stored[0]!.id);
    expect(detail.lineItems.length).toBeGreaterThan(0);
  }, 120_000);

  it("GAIN-06: derived capital gains require review and are never confirmed", async () => {
    const user = await createUser("gains");
    await svc.tax.ensureFinancialYear(user.id, "2025-26");
    const derived = await svc.tax.deriveCapitalGains(user.id, "2025-26");
    const summary = await svc.tax.getCapitalGains(user.id, "2025-26");
    expect(derived.notice).toContain("require user review");
    expect(summary.items.every((item: { gainType: string }) => item.gainType === "MANUAL_REVIEW")).toBe(true);
    expect(summary.notice).toContain("not realized taxable capital gains");
  }, 120_000);

  it("PLAN-07: planning scenarios remain separate from actual records", async () => {
    const user = await createUser("plan");
    const before = await prisma.taxIncomeRecord.count({ where: { userId: user.id } });
    const scenario = await svc.tax.createScenario(user.id, "2025-26", "Extra deduction", { deductionsMinor: 50_000_00 });
    expect(scenario.name).toBe("Extra deduction");
    expect(await prisma.taxIncomeRecord.count({ where: { userId: user.id } })).toBe(before);
    expect(await prisma.taxPaymentRecord.count({ where: { userId: user.id } })).toBe(0);
  }, 120_000);

  it("DOC-08: document extraction requires confirmation and downloads are signed", async () => {
    const [a, b] = await Promise.all([createUser("doca"), createUser("docb")]);
    const bytes = Buffer.from("%PDF-1.4 test tax statement");
    const doc = await svc.documents.uploadDocument(a.id,
      { bytes, fileName: "form16.pdf", contentType: "application/pdf" },
      { financialYear: "2025-26", kind: "FORM_16" });
    const extracted = await svc.documents.recordExtraction(a.id, doc.id, [
      { field: "TDS_AMOUNT", value: "5000", confidenceBps: 6000 },
    ]);
    expect(extracted.fields).toBe(1);
    expect(extracted.notice).toContain("unconfirmed");
    const fields = await svc.documents.listExtractions(a.id, doc.id);
    expect(fields[0]!.userConfirmed).toBe(false);
    const link = await svc.documents.getDocumentLink(a.id, doc.id);
    const downloaded = await svc.documents.downloadDocument(a.id, doc.id, link.token, link.expiresAt);
    expect(downloaded.buffer.subarray(0, 4).toString()).toBe("%PDF");
    await expectApiError(svc.documents.getDocumentLink(b.id, doc.id), 404);
  }, 120_000);

  it("REC-09: reconciliation matches conservatively and keeps original data", async () => {
    const user = await createUser("recon");
    await svc.mapping.createIncome(user.id, {
      financialYear: "2025-26", category: "INTEREST", description: "Bank interest",
      amountMinor: 10_000_00, occurredAt: "2025-07-01T00:00:00.000Z",
    });
    const result = await svc.documents.reconcileStatement(user.id, [
      { category: "INTEREST", sourceRef: "stmt-1", amountMinor: 10_000_00 },
      { category: "TDS", sourceRef: "stmt-2", amountMinor: 1_000_00 },
    ], "2025-26");
    expect(result.created).toBe(2);
    const rows = await svc.documents.listReconciliation(user.id, "2025-26");
    expect(rows.some((r: { matchLevel: string }) => r.matchLevel === "HIGH")).toBe(true);
    expect(rows.some((r: { matchLevel: string }) => r.matchLevel === "UNMATCHED")).toBe(true);
  }, 120_000);

  it("FILE-10: filing readiness assesses state without claiming a return was filed", async () => {
    const user = await createUser("filing");
    const readiness = await svc.tax.getFilingReadiness(user.id, "2025-26");
    expect(readiness.items.length).toBeGreaterThan(0);
    expect(readiness.notice).toContain("No return has been prepared, submitted or acknowledged");
    const answer = await svc.tax.assistantAnswer(user.id, "What is the difference between financial year and assessment year?", "2025-26");
    expect(answer.answer).toContain("2026-27");
  }, 120_000);

  it("SEC-11: users cannot access each other's tax calculations", async () => {
    const [a, b] = await Promise.all([createUser("seca"), createUser("secb")]);
    await svc.tax.calculateAndStore(a.id, "2025-26", "NEW", baseInput);
    const mine = await svc.tax.listCalculations(a.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(await svc.tax.listCalculations(b.id)).toHaveLength(0);
    await expectApiError(svc.tax.getCalculation(b.id, mine[0]!.id), 404);
  }, 120_000);

  it("OPS-12: Control reports real processing state", async () => {
    const view = await svc.control.getTaxOperations();
    expect(view.ruleSets).toBeGreaterThan(0);
    expect(typeof view.failedJobs).toBe("number");
    expect(view.calculations).toBeGreaterThan(0);
  }, 120_000);
});
