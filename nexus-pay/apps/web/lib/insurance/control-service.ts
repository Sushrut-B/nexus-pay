import { prisma } from "@nexus/database";
import type { InsuranceOperationsView } from "@nexus/shared-types";

export async function getInsuranceOperations(): Promise<InsuranceOperationsView> {
  const [providers, products, applications, policies, claims, webhookFailures, backlog, lastSync] = await Promise.all([
    prisma.insuranceProvider.count(),
    prisma.insuranceProduct.count({ where: { status: "ACTIVE" } }),
    prisma.insuranceApplication.count(),
    prisma.insurancePolicy.count(),
    prisma.insuranceClaim.count(),
    prisma.insuranceProviderWebhook.count({ where: { status: "FAILED" } }),
    prisma.insuranceProviderSync.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
    prisma.insuranceProvider.findFirst({ where: { lastSyncAt: { not: null } }, orderBy: { lastSyncAt: "desc" }, select: { lastSyncAt: true } }),
  ]);
  return {
    providers, products, applications, policies, claims, webhookFailures, syncBacklog: backlog,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null,
    currency: "INR",
  };
}

export async function listInsuranceApplications(limit = 100) {
  return prisma.insuranceApplication.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function listInsuranceEvents(limit = 100) {
  return prisma.insuranceProviderWebhook.findMany({ include: { provider: true }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function listInsuranceConsents(limit = 100) {
  return prisma.insuranceConsent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
