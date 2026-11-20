import { prisma, type TaxIncomeRecord } from "@nexus/database";
import type { TaxIncomeView, TaxIncomeCategory } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { loadClassifiedTransactions, moneyMovements, type ClassifiedRecord } from "@/lib/finance-intelligence/classification-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

export const TAX_NOTICE =
  "Nexus Pay is not a chartered accountancy firm, tax practitioner or filing intermediary. Figures are estimates from your records, not assessed tax. No wallet transfer is automatically income.";

export function financialYearRange(financialYear: string): { from: Date; to: Date; assessmentYear: string } {
  const [start] = financialYear.split("-");
  const year = Number(start);
  if (!Number.isFinite(year)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid financial year.");
  return {
    from: new Date(Date.UTC(year, 3, 1)),
    to: new Date(Date.UTC(year + 1, 2, 31, 23, 59, 59)),
    assessmentYear: `${year + 1}-${String((year + 2) % 100).padStart(2, "0")}`,
  };
}

function inferCategory(record: ClassifiedRecord): { category: TaxIncomeCategory; assumptions: string[] } {
  const assumptions: string[] = [];
  let category: TaxIncomeCategory = "OTHER";
  if (record.sourceType === "MERCHANT_PAYMENT") {
    category = "BUSINESS";
    assumptions.push("Merchant settlement treated as potentially taxable business receipt.");
  } else if (record.sourceType === "BILL_PAYMENT" || record.sourceType === "TRAVEL_BOOKING") {
    category = "OTHER";
    assumptions.push("Bill/travel records are outflow records and are not income.");
  } else if (record.sourceType === "CASHBACK" || record.sourceType === "REWARD_LEDGER") {
    category = "OTHER";
    assumptions.push("Cashback and rewards require specific tax classification; not treated as salary.");
  } else if (record.sourceType === "EXTERNAL_TRANSACTION") {
    category = "OTHER";
    assumptions.push("External credit requires source identification before classification.");
  } else if (record.sourceType === "TRANSACTION") {
    category = "OTHER";
    assumptions.push("Wallet receipt is not automatically income — verify the source.");
  }
  return { category, assumptions };
}

export function incomeView(row: TaxIncomeRecord): TaxIncomeView {
  return {
    id: row.id, financialYear: row.financialYear, category: row.category,
    classification: row.classification, sourceType: row.sourceType, sourceModule: row.sourceModule,
    sourceRef: row.sourceRef, description: row.description, amountMinor: row.amountMinor,
    occurredAt: row.occurredAt.toISOString(), userConfirmed: row.userConfirmed,
    assumptions: row.assumptions,
  };
}

/**
 * Single data path: call the canonical classification engine once, then derive
 * candidate tax records from provenance. Never re-sum raw tables.
 */
export async function consolidateIncome(userId: string, financialYear: string) {
  const { from, to } = financialYearRange(financialYear);
  const result = await loadClassifiedTransactions(userId, from, to, { includeExternal: true });
  const inflows = result.records.filter((record) => record.direction === "IN" && !record.isAdjustment);
  let created = 0;
  for (const record of inflows) {
    const { category, assumptions } = inferCategory(record);
    await prisma.taxIncomeRecord.upsert({
      where: {
        userId_sourceModule_sourceRef: {
          userId, sourceModule: record.sourceType,
          sourceRef: record.paymentRef ?? record.sourceId,
        },
      },
      create: {
        userId, financialYear, category,
        classification: "POTENTIALLY_TAXABLE",
        sourceType: "SYSTEM_DERIVED",
        sourceModule: record.sourceType,
        sourceRef: record.paymentRef ?? record.sourceId,
        description: record.description.slice(0, 300),
        amountMinor: record.amountMinor,
        currency: record.currency,
        occurredAt: record.occurredAt,
        assumptions: assumptions.join(" "),
      },
      update: {},
    });
    created += 1;
  }
  await publishSecurityEvent({
    eventId: `tax_consolidate_${userId}_${financialYear}`, type: "TAX_RECONCILIATION_REQUIRED",
    occurredAt: new Date(), actorId: userId, subjectId: financialYear, sourceModule: "tax",
    metadata: { records: inflows.length },
  });
  return {
    consolidated: created,
    totalInflowMinor: moneyMovements(result.records).inflowMinor,
    issues: result.issues,
    notice: TAX_NOTICE,
  };
}

export async function listIncome(userId: string, financialYear: string) {
  const rows = await prisma.taxIncomeRecord.findMany({
    where: { userId, financialYear }, orderBy: { occurredAt: "desc" }, take: 200,
  });
  return rows.map(incomeView);
}

export async function createIncome(userId: string, input: {
  financialYear: string; category: TaxIncomeCategory; description: string; amountMinor: number;
  occurredAt: string; classification?: "POTENTIALLY_TAXABLE" | "TAX_EXEMPT" | "TAXABLE" | "NON_TAXABLE" | "REQUIRES_REVIEW"; assumptions?: string;
}) {
  const row = await prisma.taxIncomeRecord.create({
    data: {
      userId, financialYear: input.financialYear, category: input.category,
      classification: input.classification ?? "POTENTIALLY_TAXABLE",
      sourceType: "USER_DECLARED", sourceModule: "USER",
      sourceRef: `user-${Date.now()}`,
      description: input.description, amountMinor: input.amountMinor,
      currency: "INR", occurredAt: new Date(input.occurredAt),
      assumptions: input.assumptions ?? "User-declared income — not independently verified.",
    },
  });
  return incomeView(row);
}

async function owned(userId: string, id: string) {
  const row = await prisma.taxIncomeRecord.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Tax income record not found.");
  return row;
}

export async function updateIncome(userId: string, id: string, input: {
  classification?: string; category?: TaxIncomeCategory; userConfirmed?: boolean; note?: string;
}) {
  await owned(userId, id);
  const row = await prisma.taxIncomeRecord.update({
    where: { id },
    data: {
      ...(input.classification ? { classification: input.classification as never } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.userConfirmed !== undefined ? { userConfirmed: input.userConfirmed, classification: input.userConfirmed ? "USER_CONFIRMED" : "REQUIRES_REVIEW" } : {}),
      ...(input.note ? { assumptions: input.note } : {}),
    },
  });
  return incomeView(row);
}

export async function deleteIncome(userId: string, id: string) {
  await owned(userId, id);
  await prisma.taxIncomeRecord.delete({ where: { id } });
  return { id, deleted: true };
}
