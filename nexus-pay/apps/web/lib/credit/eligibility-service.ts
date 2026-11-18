import { prisma } from "@nexus/database";
import type { EligibilityResult } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import type { EligibilityInput } from "@nexus/validation";
import { getProduct } from "@/lib/credit/catalog-service";
import { getLenderAdapter } from "@/lib/credit/providers";
import { getCashFlow } from "@/lib/finance-intelligence/aggregation-service";

export async function assessEligibility(userId: string, input: EligibilityInput): Promise<EligibilityResult> {
  const product = await getProduct(input.productId);
  const productRow = await prisma.creditProduct.findUniqueOrThrow({ where: { id: product.id } });
  const adapter = getLenderAdapter(
    await prisma.lendingProvider.findUniqueOrThrow({ where: { id: product.providerId } }).then((row) => row.code),
  );

  // Observed data is read-only context from Release 9. Employment and salary
  // are never inferred from spending activity.
  const cashFlow = await getCashFlow(userId, "month");
  const observedData = {
    recordedMonthlyInflowMinor: cashFlow.totalInflowMinor,
    recordedMonthlyOutflowMinor: cashFlow.totalOutflowMinor,
    observationPeriod: cashFlow.period,
    note: "Observed Nexus Pay records only; not employment or salary evidence.",
  };
  const providerResult = await adapter.assessEligibility({
    productCode: productRow.code,
    answers: {
      requestedAmountMinor: input.requestedAmountMinor,
      monthlyIncomeRange: input.monthlyIncomeRange,
      existingObligationsMinor: input.existingObligationsMinor,
    },
    observedData,
  }).catch(() => ({ outcome: "PRE_ASSESSMENT_ONLY" as const, explanation: "Provider assessment unavailable; internal pre-assessment only.", providerRef: undefined as string | undefined }));

  const outcome = providerResult.outcome === "PROVIDER_ELIGIBLE"
    ? "PRE_ASSESSMENT_ONLY"
    : providerResult.outcome === "PROVIDER_INELIGIBLE"
      ? "PRE_ASSESSMENT_ONLY"
      : "PRE_ASSESSMENT_ONLY";

  const row = await prisma.eligibilityAssessment.create({
    data: {
      userId,
      productId: product.id,
      outcome,
      source: "INTERNAL_PRE_ASSESSMENT",
      answers: {
        employmentCategory: input.employmentCategory,
        monthlyIncomeRange: input.monthlyIncomeRange,
        employmentMonths: input.employmentMonths,
        existingObligationsMinor: input.existingObligationsMinor,
        requestedAmountMinor: input.requestedAmountMinor,
        requestedTenureMonths: input.requestedTenureMonths,
        purpose: input.purpose,
      } as object,
      observedData: observedData as object,
      result: {
        explanation: providerResult.explanation,
        providerOutcome: providerResult.outcome,
      } as object,
      providerRef: providerResult.providerRef ?? null,
    },
  });
  return {
    id: row.id,
    outcome,
    source: "INTERNAL_PRE_ASSESSMENT",
    explanation: "This is a pre-assessment only. It is not a credit approval, does not guarantee acceptance and is not a bureau score.",
    observedFields: Object.keys(observedData).filter((key) => key !== "note"),
    declaredFields: ["employmentCategory", "monthlyIncomeRange", "employmentMonths", "requestedAmountMinor", "requestedTenureMonths", "purpose"],
    providerRef: providerResult.providerRef ?? null,
    createdAt: row.createdAt.toISOString(),
    notice: "No lender decision has been made.",
  };
}

export async function getEligibility(userId: string, id: string): Promise<EligibilityResult> {
  const row = await prisma.eligibilityAssessment.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Eligibility assessment not found.");
  return {
    id: row.id,
    outcome: row.outcome,
    source: row.source,
    explanation: "Pre-assessment only; not a credit approval or bureau score.",
    observedFields: Object.keys((row.observedData as object) ?? {}),
    declaredFields: Object.keys((row.answers as object) ?? {}),
    providerRef: row.providerRef,
    createdAt: row.createdAt.toISOString(),
    notice: "No lender decision has been made.",
  };
}
