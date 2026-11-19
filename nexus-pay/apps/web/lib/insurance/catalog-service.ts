import { prisma, type InsuranceProduct } from "@nexus/database";
import type { InsuranceComparisonView, InsuranceProductView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getInsurerAdapter, listInsurerProviders } from "@/lib/insurance/providers";

export function productView(row: InsuranceProduct & { provider: { displayName: string }; documents: Array<{ name: string; url: string; type: string }> }): InsuranceProductView {
  return {
    id: row.id,
    providerId: row.providerId,
    providerName: row.provider.displayName,
    code: row.code,
    name: row.name,
    category: row.category,
    summary: row.summary,
    coverageSummary: row.coverageSummary,
    coverageMinor: row.coverageMinor,
    premiumMinor: row.premiumMinor,
    premiumFrequency: row.premiumFrequency,
    durationMonths: row.durationMonths,
    benefits: (row.benefits as string[] | null) ?? [],
    exclusions: (row.exclusions as string[] | null) ?? [],
    waitingPeriods: (row.waitingPeriods as string[] | null) ?? [],
    eligibility: (row.eligibility as string[] | null) ?? [],
    deductibles: (row.deductibles as string[] | null) ?? [],
    addons: (row.addons as string[] | null) ?? [],
    claimProcess: row.claimProcess,
    renewalTerms: row.renewalTerms,
    documents: row.documents.map((document) => ({ name: document.name, url: document.url, type: document.type })),
    source: row.source,
    sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
    isSandbox: row.source === "SANDBOX_FIXTURE",
  };
}

export async function syncCatalog(): Promise<{ products: number }> {
  let products = 0;
  for (const provider of listInsurerProviders().filter((item) => item.available)) {
    const adapter = getInsurerAdapter(provider.code);
    const dbProvider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { code: provider.code } });
    for (const product of await adapter.getProducts()) {
      const row = await prisma.insuranceProduct.upsert({
        where: { code: product.code },
        create: {
          providerId: dbProvider.id,
          code: product.code,
          name: product.name,
          category: product.category,
          summary: product.summary,
          coverageSummary: product.coverageSummary ?? null,
          coverageMinor: product.coverageMinor ?? null,
          premiumMinor: product.premiumMinor ?? null,
          premiumFrequency: product.premiumFrequency ?? "YEARLY",
          durationMonths: product.durationMonths ?? null,
          benefits: (product.benefits ?? []) as object,
          exclusions: (product.exclusions ?? []) as object,
          waitingPeriods: (product.waitingPeriods ?? []) as object,
          eligibility: (product.eligibility ?? []) as object,
          deductibles: (product.deductibles ?? []) as object,
          addons: (product.addons ?? []) as object,
          claimProcess: product.claimProcess ?? null,
          renewalTerms: product.renewalTerms ?? null,
          officialDocs: (product.documents ?? []) as object,
          source: "SANDBOX_FIXTURE",
          sourceUpdatedAt: product.sourceUpdatedAt,
        },
        update: {
          summary: product.summary,
          coverageMinor: product.coverageMinor ?? null,
          premiumMinor: product.premiumMinor ?? null,
          sourceUpdatedAt: product.sourceUpdatedAt,
          status: "ACTIVE",
        },
      });
      await prisma.insuranceProductVersion.upsert({
        where: { productId_version: { productId: row.id, version: product.sourceUpdatedAt.toISOString() } },
        create: { productId: row.id, version: product.sourceUpdatedAt.toISOString(), details: product as object },
        update: {},
      });
      for (const document of product.documents ?? []) {
        await prisma.insuranceProductDocument.create({
          data: {
            productId: row.id,
            name: document.name,
            url: document.url,
            documentType: document.type,
          },
        });
      }
      products += 1;
    }
    await prisma.insuranceProvider.update({ where: { id: dbProvider.id }, data: { lastSyncAt: new Date() } });
  }
  return { products };
}

export async function listProducts(category?: string): Promise<InsuranceProductView[]> {
  const rows = await prisma.insuranceProduct.findMany({
    where: { status: "ACTIVE", ...(category ? { category: category as never } : {}) },
    include: { provider: true, documents: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map((row) => productView(row as never));
}

export async function getProduct(id: string): Promise<InsuranceProductView> {
  const row = await prisma.insuranceProduct.findUnique({
    where: { id }, include: { provider: true, documents: true },
  });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Insurance product not found.");
  return productView(row as never);
}

export async function compareProducts(ids: string[]): Promise<InsuranceComparisonView> {
  const products = await Promise.all(ids.map(getProduct));
  const category = products[0]!.category;
  if (products.some((product) => product.category !== category)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Only products in the same category can be compared.");
  }
  const fields = ["coverageMinor", "premiumMinor", "durationMonths", "exclusions", "waitingPeriods", "deductibles"];
  const missing = fields.filter((field) => products.every((product) => (product as never as Record<string, unknown>)[field] == null));
  return {
    products,
    category,
    missingFields: missing,
    comparisonAt: new Date().toISOString(),
    notice: "Values are provider-reported where available. Missing information is shown as unavailable. No ranking score is applied.",
  };
}
