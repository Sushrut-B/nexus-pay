import { prisma, type InsuranceClaimStatus } from "@nexus/database";
import type { InsuranceClaimView } from "@nexus/shared-types";
import type { InsuranceClaimCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { getInsurerAdapter } from "@/lib/insurance/providers";

export function claimView(row: {
  id: string; policyId: string; providerId: string; providerRef: string; claimType: string;
  incidentDate: Date; status: InsuranceClaimStatus; submittedAt: Date | null;
  requestedDocuments: unknown; lastUpdate: Date; provider: { displayName: string };
}, documentCount = 0): InsuranceClaimView {
  return {
    id: row.id, policyId: row.policyId, providerName: row.provider.displayName,
    providerRef: row.providerRef, claimType: row.claimType,
    incidentDate: row.incidentDate.toISOString(), status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    requestedDocuments: (row.requestedDocuments as string[] | null) ?? [],
    lastUpdate: row.lastUpdate.toISOString(), documentCount,
  };
}

async function findClaim(userId: string, id: string) {
  const row = await prisma.insuranceClaim.findFirst({
    where: { id, userId }, include: { provider: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Claim not found.");
  return row;
}

export async function listClaims(userId: string): Promise<InsuranceClaimView[]> {
  const rows = await prisma.insuranceClaim.findMany({ where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => claimView(row));
}

export async function getClaim(userId: string, id: string): Promise<InsuranceClaimView> {
  const row = await findClaim(userId, id);
  const documentCount = await prisma.insuranceDocument.count({ where: { userId, ownerType: "CLAIM", ownerId: id, status: { not: "DELETED" } } });
  return claimView(row, documentCount);
}

export async function createClaim(userId: string, input: InsuranceClaimCreateInput): Promise<InsuranceClaimView> {
  const policy = await prisma.insurancePolicy.findFirst({ where: { id: input.policyId, userId } });
  if (!policy) throw new ApiError(404, "AUTHORIZATION_ERROR", "Policy not found.");
  const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: policy.providerId } });
  const adapter = getInsurerAdapter(provider.code);
  const result = await adapter.initiateClaim(policy.providerRef, input.claimType);
  if (!result) throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support claim initiation.");
  const row = await prisma.insuranceClaim.create({
    data: {
      userId,
      policyId: policy.id,
      providerId: policy.providerId,
      providerRef: result.providerRef,
      claimType: input.claimType,
      incidentDate: new Date(input.incidentDate),
      status: (result.status as InsuranceClaimStatus) ?? "DRAFT",
      requestedDocuments: (result.requestedDocuments ?? []) as object,
      providerContact: policy.providerContact ?? {},
    },
  });
  await prisma.insuranceClaimStatusHistory.create({
    data: { claimId: row.id, toStatus: row.status, actor: userId, reason: "Claim created" },
  });
  return claimView({ ...row, provider });
}

export async function submitClaim(userId: string, id: string): Promise<InsuranceClaimView> {
  const row = await findClaim(userId, id);
  if (!["DRAFT", "DOCUMENTS_REQUIRED", "READY_TO_SUBMIT"].includes(row.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This claim cannot be submitted.");
  }
  const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: row.providerId } });
  const capability = await prisma.insuranceProviderCapability.findUnique({
    where: { providerId_capability: { providerId: provider.id, capability: "claims" } },
  });
  if (capability && !capability.enabled) {
    throw new ApiError(409, "PAYMENT_ERROR", "This provider does not accept claim submissions.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.insuranceClaim.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await tx.insuranceClaimStatusHistory.create({
      data: { claimId: id, fromStatus: row.status, toStatus: "SUBMITTED", actor: userId },
    });
  });
  await createNotification(prisma, {
    userId, type: "INSURANCE_CLAIM_SUBMITTED",
    title: "Claim submitted", body: "The provider will review the claim. Approval is not guaranteed.",
    data: { claimId: id },
  });
  return getClaim(userId, id);
}

export async function getClaimHistory(userId: string, id: string) {
  await findClaim(userId, id);
  return prisma.insuranceClaimStatusHistory.findMany({ where: { claimId: id }, orderBy: { createdAt: "asc" } });
}

/** Verified provider event updates claim status exactly once per event. */
export async function applyVerifiedClaimStatus(providerRef: string, target: InsuranceClaimStatus, evidence: string): Promise<void> {
  const row = await prisma.insuranceClaim.findFirst({ where: { providerRef } });
  if (!row || row.status === target) return;
  await prisma.$transaction(async (tx) => {
    await tx.insuranceClaim.update({ where: { id: row.id }, data: { status: target, lastUpdate: new Date() } });
    await tx.insuranceClaimStatusHistory.create({
      data: { claimId: row.id, fromStatus: row.status, toStatus: target, actor: "PROVIDER_EVENT", evidence },
    });
  });
  await createNotification(prisma, {
    userId: row.userId, type: "INSURANCE_CLAIM_STATUS_CHANGED",
    title: "Claim status update", body: `Provider status: ${target.replaceAll("_", " ")}.`,
    data: { claimId: row.id, evidence },
  });
}
