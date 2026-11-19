import { prisma } from "@nexus/database";
import type { InsuranceQuoteView } from "@nexus/shared-types";
import type { InsuranceQuoteCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { getInsurerAdapter } from "@/lib/insurance/providers";
import { getProduct } from "@/lib/insurance/catalog-service";

export function quoteView(row: {
  id: string; productId: string; providerId: string; status: string; providerRef: string | null;
  premiumMinor: number | null; coverageMinor: number | null; premiumBreakdown: unknown;
  validUntil: Date | null; createdAt: Date;
}, providerName: string): InsuranceQuoteView {
  return {
    id: row.id,
    productId: row.productId,
    providerName,
    status: row.status,
    providerRef: row.providerRef,
    premiumMinor: row.premiumMinor,
    coverageMinor: row.coverageMinor,
    premiumBreakdown: (row.premiumBreakdown as Record<string, number>) ?? {},
    validUntil: row.validUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isEstimate: false,
    notice: row.status === "QUOTE_AVAILABLE"
      ? "Provider-generated quotation. Validity is limited to the period shown."
      : "Not a confirmed quotation yet.",
  };
}

async function viewById(id: string, userId?: string) {
  const row = await prisma.insuranceQuote.findFirst({ where: { id, ...(userId ? { userId } : {}) }, include: { provider: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Quote not found.");
  return quoteView(row, row.provider.displayName);
}

export async function createQuote(userId: string, input: InsuranceQuoteCreateInput): Promise<InsuranceQuoteView> {
  const product = await getProduct(input.productId);
  const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: product.providerId } });
  const adapter = getInsurerAdapter(provider.code);
  if (!adapter.capabilities.quotes) throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support quotes.");

  const consent = await prisma.insuranceConsent.create({
    data: {
      userId,
      providerId: provider.id,
      purpose: "Insurance quotation request",
      dataCategories: ["QUOTE_INPUTS"],
      sharedFields: Object.keys(input.answers),
      version: input.consentVersion,
    },
  });

  const row = await prisma.insuranceQuote.create({
    data: {
      userId,
      productId: product.id,
      providerId: provider.id,
      status: "SUBMITTED",
      answers: input.answers as object,
      consentId: consent.id,
    },
  });

  let result;
  try {
    result = await adapter.createQuote({ productCode: product.code, answers: input.answers });
  } catch (error) {
    await prisma.insuranceQuote.update({
      where: { id: row.id }, data: { status: "FAILED", providerMetadata: { error: error instanceof Error ? error.message.slice(0, 300) : "Provider failure" } },
    });
    throw error;
  }

  const updated = await prisma.insuranceQuote.update({
    where: { id: row.id },
    data: {
      status: "QUOTE_AVAILABLE",
      providerRef: result.providerRef,
      premiumMinor: result.premiumMinor,
      premiumBreakdown: result.premiumBreakdown as object,
      coverageMinor: result.coverageMinor ?? null,
      validUntil: result.validUntil,
      providerMetadata: result.metadata as object,
      rawSnapshot: (result.rawPayload ?? {}) as object,
    },
  });
  await prisma.insuranceQuoteSnapshot.create({
    data: { quoteId: row.id, payload: (result.rawPayload ?? {}) as object },
  });
  await createNotification(prisma, {
    userId, type: "INSURANCE_QUOTE_RECEIVED",
    title: "Insurance quote received",
    body: "A provider-generated quote is available. It is not insurance coverage.",
    data: { quoteId: row.id },
  });
  return viewById(updated.id, userId);
}

export async function listQuotes(userId: string): Promise<InsuranceQuoteView[]> {
  const rows = await prisma.insuranceQuote.findMany({ where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => quoteView(row, row.provider.displayName));
}

export async function getQuote(userId: string, id: string): Promise<InsuranceQuoteView> {
  return viewById(id, userId);
}

export async function refreshQuote(userId: string, id: string): Promise<InsuranceQuoteView> {
  const row = await prisma.insuranceQuote.findFirst({ where: { id, userId }, include: { provider: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Quote not found.");
  if (!row.providerRef) throw new ApiError(409, "PAYMENT_ERROR", "This quote cannot be refreshed.");
  const adapter = getInsurerAdapter(row.provider.code);
  const result = await adapter.getQuote(row.providerRef);
  if (!result) throw new ApiError(502, "RAFTLINE_UNAVAILABLE", "Provider could not refresh this quote.");
  await prisma.insuranceQuote.update({
    where: { id },
    data: { premiumMinor: result.premiumMinor, validUntil: result.validUntil, status: "QUOTE_AVAILABLE" },
  });
  return viewById(id, userId);
}

export async function expireQuotes(): Promise<number> {
  const result = await prisma.insuranceQuote.updateMany({
    where: { status: "QUOTE_AVAILABLE", validUntil: { lte: new Date() } },
    data: { status: "QUOTE_EXPIRED" },
  });
  return result.count;
}
