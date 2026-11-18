import { prisma, type CreditOffer, type CreditProduct } from "@nexus/database";
import type { ComparisonResult, CreditOfferView, CreditProductView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getLenderAdapter, listLenderProviders } from "@/lib/credit/providers";

export function productView(row: CreditProduct & { provider: { displayName: string } }): CreditProductView {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: row.provider.displayName,
    name: row.name,
    type: row.type,
    minAmountMinor: row.minAmountMinor,
    maxAmountMinor: row.maxAmountMinor,
    interestRateBps: row.interestRateBps,
    interestRateType: row.interestRateType,
    aprBps: row.aprBps,
    minTenureMonths: row.minTenureMonths,
    maxTenureMonths: row.maxTenureMonths,
    processingFeeMinor: row.processingFeeMinor,
    processingFeeBps: row.processingFeeBps,
    otherChargesMinor: row.otherChargesMinor,
    repaymentFrequency: row.repaymentFrequency,
    prepaymentTerms: row.prepaymentTerms,
    latePaymentTerms: row.latePaymentTerms,
    requiredDocuments: row.requiredDocuments,
    terms: row.terms,
    validTo: row.validTo.toISOString(),
    source: row.source,
    isSandbox: row.source === "SANDBOX_FIXTURE",
  };
}

export function offerView(row: CreditOffer & { provider: { displayName: string }; product: { name: string; source: string } }): CreditOfferView {
  return {
    id: row.id,
    productId: row.productId,
    providerId: row.providerId,
    providerName: row.provider.displayName,
    productName: row.product.name,
    amountMinor: row.amountMinor,
    interestRateBps: row.interestRateBps,
    aprBps: row.aprBps,
    tenureMonths: row.tenureMonths,
    emiMinor: row.emiMinor,
    totalRepaymentMinor: row.totalRepaymentMinor,
    totalInterestMinor: row.totalInterestMinor,
    feesMinor: row.feesMinor,
    expiresAt: row.expiresAt.toISOString(),
    isSandbox: row.product.source === "SANDBOX_FIXTURE",
    notice: row.product.source === "SANDBOX_FIXTURE"
      ? "Sandbox development fixture — not a real credit offer or approval."
      : "Provider-backed offer (subject to lender verification).",
  };
}

/** Import provider catalogues. Only explicitly enabled providers are queried. */
export async function syncCatalog(): Promise<{ products: number; offers: number }> {
  const providers = listLenderProviders().filter((provider) => provider.available);
  let products = 0;
  let offers = 0;
  for (const provider of providers) {
    const adapter = getLenderAdapter(provider.code);
    const dbProvider = await prisma.lendingProvider.findUniqueOrThrow({ where: { code: provider.code } });
    for (const product of await adapter.fetchProducts()) {
      const row = await prisma.creditProduct.upsert({
        where: { code: product.code },
        create: {
          providerId: dbProvider.id,
          code: product.code,
          name: product.name,
          type: product.type,
          minAmountMinor: product.minAmountMinor,
          maxAmountMinor: product.maxAmountMinor,
          interestRateBps: product.interestRateBps,
          interestRateType: product.interestRateType,
          aprBps: product.aprBps ?? null,
          minTenureMonths: product.minTenureMonths,
          maxTenureMonths: product.maxTenureMonths,
          processingFeeMinor: product.processingFeeMinor ?? 0,
          processingFeeBps: product.processingFeeBps ?? 0,
          otherChargesMinor: product.otherChargesMinor ?? 0,
          repaymentFrequency: product.repaymentFrequency ?? "MONTHLY",
          eligibilityCriteria: (product.eligibilityCriteria ?? {}) as object,
          prepaymentTerms: product.prepaymentTerms ?? null,
          latePaymentTerms: product.latePaymentTerms ?? null,
          requiredDocuments: product.requiredDocuments ?? [],
          terms: product.terms ?? null,
          validFrom: product.validFrom,
          validTo: product.validTo,
          status: "ACTIVE",
          source: "SANDBOX_FIXTURE",
        },
        update: {
          name: product.name,
          interestRateBps: product.interestRateBps,
          validTo: product.validTo,
          status: "ACTIVE",
        },
      });
      products += 1;
      for (const offer of await adapter.fetchOffers(product.code)) {
        await prisma.creditOffer.upsert({
          where: {
            providerId_providerOfferRef: {
              providerId: dbProvider.id, providerOfferRef: offer.providerOfferRef,
            },
          },
          create: {
            productId: row.id,
            providerId: dbProvider.id,
            providerOfferRef: offer.providerOfferRef,
            amountMinor: offer.amountMinor,
            interestRateBps: offer.interestRateBps,
            aprBps: offer.aprBps ?? null,
            tenureMonths: offer.tenureMonths,
            emiMinor: offer.emiMinor ?? null,
            totalRepaymentMinor: offer.totalRepaymentMinor ?? null,
            totalInterestMinor: offer.totalInterestMinor ?? null,
            feesMinor: offer.feesMinor,
            expiresAt: offer.expiresAt,
            terms: offer.terms as object,
          },
          update: { expiresAt: offer.expiresAt, status: "ACTIVE" },
        });
        offers += 1;
      }
    }
  }
  return { products, offers };
}

export async function listProducts(type?: string): Promise<CreditProductView[]> {
  const rows = await prisma.creditProduct.findMany({
    where: { status: "ACTIVE", ...(type ? { type: type as never } : {}) },
    include: { provider: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map(productView);
}

export async function getProduct(id: string): Promise<CreditProductView> {
  const row = await prisma.creditProduct.findUnique({ where: { id }, include: { provider: true } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Credit product not found.");
  return productView(row);
}

export async function listOffers(): Promise<CreditOfferView[]> {
  const rows = await prisma.creditOffer.findMany({
    where: { status: "ACTIVE", expiresAt: { gt: new Date() } },
    include: { provider: true, product: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(offerView);
}

export async function getOffer(id: string): Promise<CreditOfferView> {
  const row = await prisma.creditOffer.findUnique({ where: { id }, include: { provider: true, product: true } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Credit offer not found.");
  return offerView(row);
}

export async function compareOffers(ids: string[]): Promise<ComparisonResult> {
  if (ids.length < 2 || ids.length > 4) {
    throw new ApiError(400, "VALIDATION_ERROR", "Select between two and four offers to compare.");
  }
  const offers = await Promise.all(ids.map(getOffer));
  return {
    offers,
    method: "Provider-supplied repayment values where available; otherwise standard reducing-balance EMI with integer-paise rounding.",
    assumptions: [
      "Comparison uses each offer's stated principal, rate and tenure.",
      "Fees are shown separately and are not assumed to be financed.",
      "Sandbox fixtures are not real credit offers and cannot be accepted.",
    ],
    currency: "INR",
    notice: "This comparison is informational and is not a lending decision or approval.",
  };
}
