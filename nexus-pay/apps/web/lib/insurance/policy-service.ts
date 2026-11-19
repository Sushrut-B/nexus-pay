import { prisma } from "@nexus/database";
import type { InsurancePolicyView, InsurancePremiumView, InsuranceRenewalView, InsuranceOverviewView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import type { InsurerPolicyData } from "@/lib/insurance/insurer-adapter";

export function policyView(row: {
  id: string; providerId: string; policyNumberMasked: string; category: string;
  coverageMinor: number; premiumMinor: number; premiumFrequency: string;
  startDate: Date; endDate: Date; renewalDate: Date | null; status: string;
  providerReportedAt: Date; provider: { displayName: string; mode: string };
}): InsurancePolicyView {
  return {
    id: row.id,
    providerName: row.provider.displayName,
    policyNumberMasked: row.policyNumberMasked,
    category: row.category as InsurancePolicyView["category"],
    coverageMinor: row.coverageMinor,
    premiumMinor: row.premiumMinor,
    premiumFrequency: row.premiumFrequency,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    renewalDate: row.renewalDate?.toISOString() ?? null,
    status: row.status,
    providerReportedAt: row.providerReportedAt.toISOString(),
    isSandbox: row.provider.mode === "SANDBOX",
  };
}

export async function listPolicies(userId: string): Promise<InsurancePolicyView[]> {
  const rows = await prisma.insurancePolicy.findMany({ where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(policyView);
}

export async function getPolicy(userId: string, id: string): Promise<InsurancePolicyView> {
  const row = await prisma.insurancePolicy.findFirst({ where: { id, userId }, include: { provider: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Policy not found.");
  return policyView(row);
}

/** Policies are created only from provider-confirmed data. No local activation. */
export async function createPolicyFromProvider(input: {
  userId: string;
  applicationId: string;
  providerId: string;
  data: InsurerPolicyData;
  category: InsurancePolicyView["category"];
  evidence: string;
}): Promise<string> {
  const existing = await prisma.insurancePolicy.findFirst({
    where: { providerId: input.providerId, providerRef: input.data.providerRef },
  });
  if (existing) return existing.id;
  const row = await prisma.insurancePolicy.create({
    data: {
      userId: input.userId,
      applicationId: input.applicationId,
      providerId: input.providerId,
      providerRef: input.data.providerRef,
      policyNumberMasked: input.data.policyNumberMasked,
      category: input.category,
      coverageMinor: input.data.coverageMinor,
      premiumMinor: input.data.premiumMinor,
      premiumFrequency: "YEARLY",
      startDate: input.data.startDate,
      endDate: input.data.endDate,
      status: input.data.status === "ACTIVE" ? "ACTIVE" : "PENDING_ISSUANCE",
      nominee: (input.data.nominee ?? {}) as object,
      providerContact: (input.data.providerContact ?? {}) as object,
      providerReportedAt: new Date(),
    },
  });
  await prisma.insuranceRenewal.create({
    data: {
      policyId: row.id,
      providerRef: `${input.data.providerRef}:renewal`,
      renewalDate: input.data.endDate,
      status: "PENDING",
    },
  }).catch(() => undefined);
  await createNotification(prisma, {
    userId: input.userId, type: "INSURANCE_POLICY_ISSUED",
    title: "Policy issued by provider",
    body: "Coverage status is provider-confirmed. Review the policy documents.",
    data: { policyId: row.id, evidence: input.evidence },
  });
  return row.id;
}

export async function getPremiums(userId: string, policyId: string): Promise<InsurancePremiumView[]> {
  await getPolicy(userId, policyId);
  const rows = await prisma.insurancePremiumSchedule.findMany({ where: { policyId }, orderBy: { installmentNo: "asc" }, take: 200 });
  return rows.map((row) => ({
    id: row.id, installmentNo: row.installmentNo, dueDate: row.dueDate.toISOString(),
    amountMinor: row.amountMinor, status: row.status, providerPaymentRef: row.providerPaymentRef,
    gracePeriodDays: row.gracePeriodDays, lastSyncAt: row.lastSyncAt.toISOString(),
  }));
}

export async function getRenewals(userId: string, policyId: string): Promise<InsuranceRenewalView[]> {
  await getPolicy(userId, policyId);
  const rows = await prisma.insuranceRenewal.findMany({ where: { policyId }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id, policyId: row.policyId, status: row.status, renewalDate: row.renewalDate.toISOString(),
    userConfirmed: row.userConfirmed, quoteRef: row.quoteRef, documentRef: row.documentRef,
  }));
}

export async function getOverview(userId: string): Promise<InsuranceOverviewView> {
  const [policies, applications, renewals, premiums, claims] = await Promise.all([
    prisma.insurancePolicy.count({ where: { userId } }),
    prisma.insuranceApplication.count({ where: { userId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED"] } } }),
    prisma.insuranceRenewal.count({ where: { policy: { userId }, renewalDate: { lte: new Date(Date.now() + 90 * 86_400_000) } } }),
    prisma.insurancePremiumSchedule.count({ where: { policy: { userId }, status: { in: ["DUE", "OVERDUE"] } } }),
    prisma.insuranceClaim.count({ where: { userId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED"] } } }),
  ]);
  return {
    providers: await prisma.insuranceProvider.count({ where: { status: "AVAILABLE" } }),
    products: await prisma.insuranceProduct.count({ where: { status: "ACTIVE" } }),
    policies, pendingApplications: applications, upcomingRenewals: renewals,
    claimsInProgress: claims, upcomingPremiums: premiums,
    currency: "INR",
    notice: "No real insurer is connected. Sandbox fixtures are not real coverage. Policy status is provider-authoritative.",
  };
}
