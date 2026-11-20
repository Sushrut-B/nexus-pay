import { prisma, type TaxCalculation } from "@nexus/database";
import type {
  TaxDashboardView, TaxCalculationView, TaxRegimeComparisonView, TaxCapitalGainsSummary,
  TaxDeductionView, TaxCreditView, TaxScenarioView, TaxDeadlineView, TaxFilingReadinessView,
} from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getRuleConfig, supportedFinancialYears } from "@/lib/tax/tax-rules";
import { calculateTax, compareRegimes, toCalculationView, type TaxCalculationInput } from "@/lib/tax/calculation";
import { listIncome, financialYearRange, TAX_NOTICE } from "@/lib/tax/tax-mapping-service";
import { listInvestmentTransactions, getPortfolio } from "@/lib/investments/portfolio-service";
import { createNotification } from "@/lib/social/shared";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

export async function ensureFinancialYear(userId: string, financialYear: string) {
  const supported = supportedFinancialYears().find((item) => item.financialYear === financialYear);
  if (!supported) throw new ApiError(400, "VALIDATION_ERROR", `Unsupported financial year ${financialYear}.`);
  await prisma.taxFinancialYear.upsert({
    where: { userId_financialYear: { userId, financialYear } },
    create: { userId, financialYear, assessmentYear: supported.assessmentYear },
    update: {},
  });
  await prisma.taxProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  return { financialYear, assessmentYear: supported.assessmentYear, ruleSetVersion: supported.ruleSetVersion };
}

async function latestCalculation(userId: string, financialYear: string, regime: "OLD" | "NEW") {
  return prisma.taxCalculation.findFirst({
    where: { userId, financialYear, regime }, orderBy: { createdAt: "desc" },
    include: { lineItems: true },
  });
}

function viewOf(row: TaxCalculation & { lineItems: Array<{ code: string; label: string; amountMinor: number; detail: string | null }> }): TaxCalculationView {
  return toCalculationView(row.id, row.financialYear, {
    regime: row.regime, ruleSetVersion: row.ruleSetVersion, grossMinor: row.grossMinor,
    taxableMinor: row.taxableMinor, taxBeforeCreditsMinor: row.taxBeforeCreditsMinor,
    rebateMinor: row.rebateMinor, surchargeMinor: row.surchargeMinor, cessMinor: row.cessMinor,
    creditsMinor: row.creditsMinor, netTaxMinor: row.netTaxMinor,
    lineItems: row.lineItems, assumptions: (row.assumptions as string[] | null) ?? [],
  });
}

export async function calculateAndStore(userId: string, financialYear: string, regime: "OLD" | "NEW", input: TaxCalculationInput): Promise<TaxCalculationView> {
  await ensureFinancialYear(userId, financialYear);
  const config = getRuleConfig(financialYear, regime);
  const result = calculateTax(input, config);
  const row = await prisma.taxCalculation.create({
    data: {
      userId, financialYear, regime, ruleSetVersion: result.ruleSetVersion,
      status: "COMPLETED", grossMinor: result.grossMinor, taxableMinor: result.taxableMinor,
      taxBeforeCreditsMinor: result.taxBeforeCreditsMinor, rebateMinor: result.rebateMinor,
      surchargeMinor: result.surchargeMinor, cessMinor: result.cessMinor,
      creditsMinor: result.creditsMinor, netTaxMinor: result.netTaxMinor,
      assumptions: result.assumptions as object,
      lineItems: { create: result.lineItems },
    },
    include: { lineItems: true },
  });
  await createNotification(prisma, {
    userId, type: "TAX_CALCULATION_READY", title: "Tax estimate ready",
    body: "Your estimated tax position is available. It is not an assessed tax liability.",
    data: { calculationId: row.id },
  });
  return viewOf(row);
}

export async function compareAndStore(userId: string, financialYear: string, input: TaxCalculationInput): Promise<TaxRegimeComparisonView> {
  await ensureFinancialYear(userId, financialYear);
  const result = compareRegimes(input, financialYear);
  const oldCalc = await calculateAndStore(userId, financialYear, "OLD", input);
  const newCalc = await calculateAndStore(userId, financialYear, "NEW", input);
  await prisma.taxRegimeComparison.create({
    data: {
      userId, financialYear, oldCalculationId: oldCalc.id, newCalculationId: newCalc.id,
      differenceMinor: result.differenceMinor,
    },
  });
  return {
    financialYear, ruleSetVersion: oldCalc.ruleSetVersion,
    old: oldCalc, new: newCalc, differenceMinor: result.differenceMinor,
    materialDrivers: result.materialDrivers, notice: result.notice,
  };
}

export async function getDashboard(userId: string, financialYear: string): Promise<TaxDashboardView> {
  await ensureFinancialYear(userId, financialYear);
  const [income, newCalc, oldCalc, deductions, credits, gains, documents, deadlines, profile] = await Promise.all([
    listIncome(userId, financialYear),
    latestCalculation(userId, financialYear, "NEW"),
    latestCalculation(userId, financialYear, "OLD"),
    prisma.taxDeductionRecord.findMany({ where: { userId, financialYear, includeInEstimate: true } }),
    prisma.taxCreditRecord.findMany({ where: { userId, financialYear, verified: true } }),
    prisma.taxCapitalGainRecord.findMany({ where: { userId, financialYear } }),
    prisma.taxDocument.findMany({ where: { userId, financialYear, status: { not: "DELETED" } } }),
    prisma.taxDeadline.findMany({ where: { dueDate: { gte: new Date() } }, orderBy: { dueDate: "asc" }, take: 10 }),
    prisma.taxProfile.findUnique({ where: { userId } }),
  ]);
  const chosen = profile?.defaultRegime === "OLD" ? (oldCalc ?? newCalc) : (newCalc ?? oldCalc);
  const estimatedIncomeMinor = income.reduce((sum, row) => sum + row.amountMinor, 0);
  const deductionMinor = deductions.reduce((sum, row) => sum + row.amountMinor, 0);
  const verifiedTaxPaidMinor = credits.reduce((sum, row) => sum + row.amountMinor, 0);
  const totalDocs = Math.max(documents.length, 8);
  return {
    financialYear,
    assessmentYear: financialYearRange(financialYear).assessmentYear,
    ruleSetVersion: chosen?.ruleSetVersion ?? "not-calculated",
    estimatedIncomeMinor,
    taxableMinor: chosen?.taxableMinor ?? Math.max(0, estimatedIncomeMinor - deductionMinor),
    estimatedTaxMinor: chosen?.netTaxMinor ?? 0,
    verifiedTaxPaidMinor,
    remainingMinor: chosen ? Math.max(0, chosen.netTaxMinor - verifiedTaxPaidMinor) : 0,
    deductionMinor,
    capitalGainMinor: gains.reduce((sum, row) => sum + row.gainMinor, 0),
    documentCompletionBps: Math.round((documents.length / totalDocs) * 10_000),
    upcomingDeadlines: deadlines.length,
    status: !chosen ? "PARTIAL_DATA" : (income.some((row) => !row.userConfirmed) ? "REQUIRES_REVIEW" : "CALCULATED"),
    notice: TAX_NOTICE,
    currency: "INR",
  };
}

export async function getCapitalGains(userId: string, financialYear: string): Promise<TaxCapitalGainsSummary> {
  const [rows, portfolio] = await Promise.all([
    prisma.taxCapitalGainRecord.findMany({ where: { userId, financialYear }, orderBy: { saleDate: "desc" } }),
    getPortfolio(userId),
  ]);
  const realized = rows.reduce((sum, row) => sum + row.gainMinor, 0);
  const shortTerm = rows.filter((row) => row.gainType === "SHORT_TERM").reduce((sum, row) => sum + row.gainMinor, 0);
  const longTerm = rows.filter((row) => row.gainType === "LONG_TERM").reduce((sum, row) => sum + row.gainMinor, 0);
  const losses = rows.filter((row) => row.gainMinor < 0).reduce((sum, row) => sum + Math.abs(row.gainMinor), 0);
  const incomplete = rows.filter((row) => row.completeness !== "COMPLETE").length;
  return {
    realizedMinor: realized,
    unrealizedMinor: portfolio.absoluteReturnMinor,
    shortTermMinor: shortTerm,
    longTermMinor: longTerm,
    lossesMinor: losses,
    incompleteCount: incomplete,
    items: rows.map((row) => ({
      id: row.id, financialYear: row.financialYear, assetType: row.assetType, gainType: row.gainType,
      purchaseDate: row.purchaseDate?.toISOString() ?? null, saleDate: row.saleDate.toISOString(),
      saleMinor: row.saleMinor, costMinor: row.costMinor, gainMinor: row.gainMinor, completeness: row.completeness,
    })),
    notice: "Unrealized gains are not realized taxable capital gains. Calculations require complete and verified cost-basis data.",
  };
}

/** Derives candidate realized disposals from provider-reported investment transactions. */
export async function deriveCapitalGains(userId: string, financialYear: string) {
  await ensureFinancialYear(userId, financialYear);
  const { from, to } = financialYearRange(financialYear);
  const transactions = await listInvestmentTransactions(userId);
  const disposals = transactions.filter((tx) =>
    tx.type === "REDEMPTION" || tx.type === "SELL" || tx.type === "DIVIDEND",
  ).filter((tx) => new Date(tx.occurredAt) >= from && new Date(tx.occurredAt) <= to);
  const holdings = (await getPortfolio(userId)).holdings;
  let created = 0;
  for (const tx of disposals) {
    const holding = holdings.find((h) => h.id === tx.accountId || h.name.includes(tx.type));
    const cost = holding?.costMinor ?? null;
    const existing = await prisma.taxCapitalGainRecord.findFirst({
      where: { userId, financialYear, providerRef: tx.providerRef },
    });
    if (existing) continue;
    await prisma.taxCapitalGainRecord.create({
      data: {
        userId, financialYear, assetType: holding?.category ?? "OTHER",
        gainType: "MANUAL_REVIEW", saleDate: new Date(tx.occurredAt),
        saleMinor: tx.amountMinor, costMinor: cost,
        gainMinor: cost === null ? 0 : tx.amountMinor - cost,
        providerRef: tx.providerRef,
        completeness: cost === null ? "MISSING_COST_BASIS" : "PARTIAL",
        notes: cost === null
          ? "Provider-reported disposal without verified cost basis. Review before using in any estimate."
          : "Provider-reported disposal; verify holding period and acquisition expenses before classification.",
      },
    });
    created += 1;
  }
  return { created, candidates: disposals.length, notice: "Derived records require user review; no gain is treated as confirmed." };
}

export async function listDeductions(userId: string, financialYear: string): Promise<TaxDeductionView[]> {
  const rows = await prisma.taxDeductionRecord.findMany({ where: { userId, financialYear }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((row) => ({
    id: row.id, financialYear: row.financialYear, ruleCode: row.ruleCode, section: row.section,
    label: row.label, amountMinor: row.amountMinor, regime: row.regime, verified: row.verified,
    includeInEstimate: row.includeInEstimate, sourceType: row.sourceType, note: row.note,
  }));
}

export async function listCredits(userId: string, financialYear: string): Promise<TaxCreditView[]> {
  const rows = await prisma.taxCreditRecord.findMany({ where: { userId, financialYear }, orderBy: { createdAt: "desc" }, take: 200 });
  return rows.map((row) => ({
    id: row.id, financialYear: row.financialYear, kind: row.kind, amountMinor: row.amountMinor,
    verified: row.verified, status: row.status, sourceType: row.sourceType,
  }));
}

export async function listScenarios(userId: string, financialYear: string): Promise<TaxScenarioView[]> {
  const rows = await prisma.taxPlanningScenario.findMany({ where: { userId, financialYear }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => ({
    id: row.id, financialYear: row.financialYear, name: row.name,
    assumptions: (row.assumptions as Record<string, number>) ?? {},
    result: (row.result as Record<string, number>) ?? {}, createdAt: row.createdAt.toISOString(),
  }));
}

export async function createScenario(userId: string, financialYear: string, name: string, inputs: Record<string, number>) {
  await ensureFinancialYear(userId, financialYear);
  const base: TaxCalculationInput = {
    salaryMinor: inputs.salaryMinor ?? 0, otherIncomeMinor: inputs.otherIncomeMinor ?? 0,
    housePropertyMinor: inputs.housePropertyMinor ?? 0, deductionsMinor: inputs.deductionsMinor ?? 0,
    specialRateIncomeMinor: inputs.specialRateIncomeMinor ?? 0, creditsMinor: inputs.creditsMinor ?? 0,
  };
  const comparison = compareRegimes(base, financialYear);
  const row = await prisma.taxPlanningScenario.create({
    data: {
      userId, financialYear, name,
      assumptions: inputs as object,
      result: {
        oldNetTaxMinor: comparison.old.netTaxMinor,
        newNetTaxMinor: comparison.new.netTaxMinor,
        differenceMinor: comparison.differenceMinor,
      } as object,
    },
  });
  await publishSecurityEvent({
    eventId: `tax_scenario_${row.id}`, type: "TAX_CALCULATION_READY", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "tax",
    metadata: { notice: "Planning scenario only; no actual financial record created." },
  });
  return { id: row.id, name: row.name, assumptions: inputs, result: (row.result as Record<string, number>) };
}

export async function listDeadlines(financialYear: string): Promise<TaxDeadlineView[]> {
  const rows = await prisma.taxDeadline.findMany({ where: { financialYear }, orderBy: { dueDate: "asc" } });
  return rows.map((row) => ({
    id: row.id, financialYear: row.financialYear, code: row.code, title: row.title,
    dueDate: row.dueDate.toISOString(), sourceRef: row.sourceRef, status: row.status,
  }));
}

export async function getFilingReadiness(userId: string, financialYear: string): Promise<TaxFilingReadinessView> {
  const [income, docs, credits, deductions, calc] = await Promise.all([
    listIncome(userId, financialYear),
    prisma.taxDocument.findMany({ where: { userId, financialYear, status: { not: "DELETED" } } }),
    listCredits(userId, financialYear),
    listDeductions(userId, financialYear),
    latestCalculation(userId, financialYear, "NEW"),
  ]);
  const checks = [
    { code: "INCOME", label: "Income information", ok: income.length > 0 },
    { code: "SALARY_DOCS", label: "Salary documents", ok: docs.some((d) => d.kind === "FORM_16") },
    { code: "BANK_INTEREST", label: "Bank interest information", ok: income.some((i) => i.category === "INTEREST") },
    { code: "INVESTMENTS", label: "Investment statements", ok: docs.some((d) => d.kind === "INVESTMENT_STATEMENT") },
    { code: "CAPITAL_GAINS", label: "Capital gains records", ok: (await prisma.taxCapitalGainRecord.count({ where: { userId, financialYear } })) > 0 },
    { code: "TDS_TCS", label: "TDS and TCS information", ok: credits.length > 0 },
    { code: "DEDUCTIONS", label: "Eligible deduction records", ok: deductions.length > 0 },
    { code: "CALCULATION", label: "Tax calculation completed", ok: Boolean(calc) },
  ];
  const items = checks.map((check) => ({
    code: check.code, label: check.label,
    status: (check.ok ? "COMPLETE" : "INCOMPLETE") as "COMPLETE" | "INCOMPLETE",
  }));
  const complete = items.filter((item) => item.status === "COMPLETE").length;
  return {
    financialYear, items, completionBps: Math.round((complete / items.length) * 10_000),
    notice: "This is preparation only. No return has been prepared, submitted or acknowledged, and Nexus Pay is not a filing intermediary.",
  };
}

export async function assistantAnswer(userId: string, question: string, financialYear: string) {
  const dashboard = await getDashboard(userId, financialYear);
  const q = question.toLowerCase();
  if (q.includes("financial year") || q.includes("assessment year")) {
    return { answer: `You selected FY ${dashboard.financialYear}. The corresponding assessment year is ${dashboard.assessmentYear}. A financial year is the 12-month period in which income is earned; the assessment year is the following year in which it is assessed.`, sources: ["Income Tax Department"], ruleSetVersion: dashboard.ruleSetVersion };
  }
  if (q.includes("regime") || q.includes("old") || q.includes("new")) {
    return { answer: "The old regime generally allows more deductions; the new regime has lower slab rates and fewer deductions. Your comparison uses the same inputs for both and shows the versioned rules and assumptions. No regime is automatically recommended.", sources: ["Income Tax Department slab rates"], ruleSetVersion: dashboard.ruleSetVersion };
  }
  if (q.includes("estimate") || q.includes("calculated") || q.includes("tax")) {
    return { answer: `Your current estimate for FY ${dashboard.financialYear} is ₹${(dashboard.estimatedTaxMinor / 100).toLocaleString("en-IN")}. It is based on rule set ${dashboard.ruleSetVersion}, the records currently available, and the assumptions shown with the calculation. It is not an assessed liability; consult a qualified tax professional for complex matters.`, sources: [dashboard.ruleSetVersion], ruleSetVersion: dashboard.ruleSetVersion };
  }
  if (q.includes("missing") || q.includes("document")) {
    return { answer: `Your document completion is ${(dashboard.documentCompletionBps / 100).toFixed(0)}%. Review the filing-readiness checklist to see which supporting records are missing. Uploaded documents are never treated as verified until you confirm extracted values.`, sources: ["Nexus Pay document checklist"], ruleSetVersion: dashboard.ruleSetVersion };
  }
  return { answer: "I can explain tax terminology, the difference between financial and assessment years, regime differences, capital gains and how your estimate was calculated. Ask about your dashboard, documents or a specific concept. I do not provide personalized tax advice or legal conclusions.", sources: [], ruleSetVersion: dashboard.ruleSetVersion };
}

export async function listCalculations(userId: string, financialYear?: string) {
  const rows = await prisma.taxCalculation.findMany({
    where: { userId, ...(financialYear ? { financialYear } : {}) },
    include: { lineItems: true }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map(viewOf);
}

export async function getCalculation(userId: string, id: string) {
  const row = await prisma.taxCalculation.findFirst({ where: { id, userId }, include: { lineItems: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Tax calculation not found.");
  return viewOf(row);
}
