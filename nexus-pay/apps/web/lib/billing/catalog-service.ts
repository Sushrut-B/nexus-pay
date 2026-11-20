import { prisma, type Biller } from "@nexus/database";
import type { BillerView, RechargePlanView, BillCategory } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getBillerAdapter, listBillerProviders } from "@/lib/billing/providers";

export const BILL_CATEGORY_LABELS: Record<string, string> = {
  ELECTRICITY: "Electricity", WATER: "Water", GAS: "Piped gas", LPG: "LPG",
  BROADBAND: "Broadband", LANDLINE: "Landline", MOBILE_POSTPAID: "Mobile postpaid",
  MOBILE_PREPAID: "Mobile prepaid", DTH: "DTH", FASTAG: "FASTag",
  MUNICIPAL_TAX: "Municipal taxes", SOCIETY_MAINTENANCE: "Society maintenance",
  EDUCATION_FEES: "Education fees", OTHER: "Other",
};

export async function syncBillerCatalogue(): Promise<{ billers: number }> {
  let count = 0;
  for (const provider of listBillerProviders().filter((item) => item.available)) {
    const adapter = getBillerAdapter(provider.code);
    const dbProvider = await prisma.billPaymentProvider.findUniqueOrThrow({ where: { code: provider.code } });
    const availableCodes = new Set(adapter.getCategories());
    const categories = Object.keys(BILL_CATEGORY_LABELS);
    for (const code of categories) {
      await prisma.billerCategory.upsert({
        where: { code: code as never },
        create: { code: code as never, label: BILL_CATEGORY_LABELS[code]!, available: availableCodes.has(code as BillCategory) },
        update: { available: availableCodes.has(code as BillCategory) },
      });
    }
    for (const biller of await adapter.getBillers()) {
      const category = await prisma.billerCategory.findUniqueOrThrow({ where: { code: biller.category } });
      const row = await prisma.biller.upsert({
        where: { code: biller.code },
        create: {
          providerId: dbProvider.id, categoryId: category.id, code: biller.code, name: biller.name,
          billerType: biller.billerType, coverage: biller.coverage ?? null,
          canFetchBill: biller.canFetchBill, canPayBill: biller.canPayBill,
          supportsRecharge: biller.supportsRecharge, supportedModes: (biller.supportedModes ?? []) as object,
          source: "SANDBOX_FIXTURE", lastSyncAt: biller.retrievedAt,
        },
        update: {
          name: biller.name, coverage: biller.coverage ?? null,
          canFetchBill: biller.canFetchBill, canPayBill: biller.canPayBill,
          supportsRecharge: biller.supportsRecharge, lastSyncAt: biller.retrievedAt, status: "ACTIVE",
        },
      });
      for (const parameter of biller.parameters) {
        await prisma.billerParameter.upsert({
          where: { billerId_name: { billerId: row.id, name: parameter.name } },
          create: {
            billerId: row.id, name: parameter.name, label: parameter.label,
            required: parameter.required, validation: (parameter.validation ?? {}) as object,
            sensitive: parameter.sensitive ?? false,
          },
          update: { label: parameter.label, required: parameter.required, sensitive: parameter.sensitive ?? false },
        });
      }
      await prisma.billerCatalogueVersion.create({
        data: { billerId: row.id, version: biller.retrievedAt.toISOString(), payload: biller as object },
      }).catch(() => undefined);
      count += 1;
    }
    await prisma.billPaymentProvider.update({ where: { id: dbProvider.id }, data: { lastSyncAt: new Date() } });
  }
  return { billers: count };
}

export function billerView(row: Biller & { provider: { displayName: string }; category: { code: string }; parameters: Array<{ name: string; label: string; required: boolean; sensitive: boolean }> }): BillerView {
  return {
    id: row.id, name: row.name, category: row.category.code as BillCategory,
    billerType: row.billerType, providerName: row.provider.displayName,
    coverage: row.coverage, canFetchBill: row.canFetchBill, canPayBill: row.canPayBill,
    supportsRecharge: row.supportsRecharge,
    parameters: row.parameters.map((p) => ({ name: p.name, label: p.label, required: p.required, sensitive: p.sensitive })),
    source: row.source, lastSyncAt: row.lastSyncAt.toISOString(),
  };
}

export async function listBillers(category?: string) {
  const rows = await prisma.biller.findMany({
    where: { status: "ACTIVE", ...(category ? { category: { code: category as never } } : {}) },
    include: { provider: true, category: true, parameters: { orderBy: { displayOrder: "asc" } } },
    orderBy: { name: "asc" }, take: 200,
  });
  return rows.map((row) => billerView(row as never));
}

export async function getBiller(id: string) {
  const row = await prisma.biller.findUnique({
    where: { id }, include: { provider: true, category: true, parameters: { orderBy: { displayOrder: "asc" } } },
  });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Biller not found.");
  return billerView(row as never);
}

export async function getInternalBiller(id: string) {
  const row = await prisma.biller.findUnique({ where: { id }, include: { provider: true } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Biller not found.");
  return row;
}

export async function listCategories() {
  return prisma.billerCategory.findMany({ orderBy: { label: "asc" } });
}

export async function listPlans(billerId: string): Promise<RechargePlanView[]> {
  const biller = await getInternalBiller(billerId);
  const adapter = getBillerAdapter(biller.provider.code);
  if (!adapter.capabilities.plans) return [];
  const plans = await adapter.getPlans(biller.code);
  return plans.map((plan) => ({
    id: `${biller.id}:${plan.code}`, billerId, code: plan.code, name: plan.name,
    priceMinor: plan.priceMinor, validity: plan.validity ?? null, dataAllowance: plan.dataAllowance ?? null,
    benefits: plan.benefits ?? [], terms: plan.terms ?? null, retrievedAt: new Date().toISOString(),
  }));
}
