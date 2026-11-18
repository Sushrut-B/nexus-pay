import { prisma } from "@nexus/database";
import type { AffordabilityView } from "@nexus/shared-types";
import type { AffordabilityInput } from "@nexus/validation";
import { calculateEmi } from "@/lib/credit/calculations";
import { getCashFlow } from "@/lib/finance-intelligence/aggregation-service";
import { loadClassifiedTransactions } from "@/lib/finance-intelligence/classification-service";

export async function createScenario(userId: string, input: AffordabilityInput): Promise<AffordabilityView> {
  const now = new Date();
  const cashFlow = await getCashFlow(userId, "month");
  const classified = await loadClassifiedTransactions(
    userId,
    new Date(now.getTime() - 90 * 86_400_000),
    now,
  );
  const commitments = await prisma.activeLoan.aggregate({
    where: { userId, status: "ACTIVE" },
    _sum: { emiMinor: true },
  });
  const monthlyCommitments = commitments._sum.emiMinor ?? 0;
  const calculation = calculateEmi(input.amountMinor, input.interestRateBps, input.tenureMonths);
  const remaining = cashFlow.totalInflowMinor - cashFlow.totalOutflowMinor - monthlyCommitments - calculation.emiMinor;
  const coverage = classified.records.length === 0
    ? 0
    : Math.min(10_000, Math.round((classified.records.filter((row) => row.category !== "REWARD").length / classified.records.length) * 10_000));

  const row = await prisma.loanAffordabilityScenario.create({
    data: {
      userId,
      amountMinor: input.amountMinor,
      tenureMonths: input.tenureMonths,
      interestRateBps: input.interestRateBps,
      emiMinor: calculation.emiMinor,
      currentInflowMinor: cashFlow.totalInflowMinor,
      currentOutflowMinor: cashFlow.totalOutflowMinor,
      commitmentsMinor: monthlyCommitments,
      remainingMinor: remaining,
      assumptions: calculation.assumptions as object,
      dataCoverageBps: coverage,
    },
  });
  return view(row);
}

export async function listScenarios(userId: string): Promise<AffordabilityView[]> {
  const rows = await prisma.loanAffordabilityScenario.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map(view);
}

function view(row: {
  id: string; amountMinor: number; tenureMonths: number; interestRateBps: number; emiMinor: number;
  currentInflowMinor: number; currentOutflowMinor: number; commitmentsMinor: number; remainingMinor: number;
  assumptions: unknown; dataCoverageBps: number;
}): AffordabilityView {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    tenureMonths: row.tenureMonths,
    interestRateBps: row.interestRateBps,
    emiMinor: row.emiMinor,
    currentInflowMinor: row.currentInflowMinor,
    currentOutflowMinor: row.currentOutflowMinor,
    commitmentsMinor: row.commitmentsMinor,
    remainingMinor: row.remainingMinor,
    assumptions: (row.assumptions as { assumptions?: string[] }).assumptions ?? [],
    dataCoverageBps: row.dataCoverageBps,
    currency: "INR",
    notice: "Informational cash-flow scenario only. Not a lending decision, approval or guarantee of affordability.",
  };
}
