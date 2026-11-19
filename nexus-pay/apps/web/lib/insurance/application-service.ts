import { prisma, type InsuranceApplicationStatus } from "@nexus/database";
import type { InsuranceApplicationView } from "@nexus/shared-types";
import type { InsuranceApplicationCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { getInsurerAdapter } from "@/lib/insurance/providers";
import { getProduct } from "@/lib/insurance/catalog-service";
import { requireActiveConsent } from "@/lib/insurance/consent-service";

const TRANSITIONS: Record<InsuranceApplicationStatus, InsuranceApplicationStatus[]> = {
  DRAFT: ["READY_FOR_SUBMISSION", "SUBMITTED", "CANCELLED"],
  READY_FOR_SUBMISSION: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "REJECTED", "FAILED", "CANCELLED", "COMPLETED"],
  UNDER_REVIEW: ["ADDITIONAL_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "POLICY_ISSUANCE_PENDING", "COMPLETED", "CANCELLED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["UNDER_REVIEW", "REJECTED", "CANCELLED", "FAILED"],
  APPROVED: ["POLICY_ISSUANCE_PENDING", "COMPLETED", "CANCELLED"],
  REJECTED: [],
  POLICY_ISSUANCE_PENDING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: ["SUBMITTED", "CANCELLED"],
};

export async function applicationView(id: string, userId?: string): Promise<InsuranceApplicationView> {
  const row = await prisma.insuranceApplication.findFirst({
    where: { id, ...(userId ? { userId } : {}) },
    include: { provider: true, _count: { select: { policies: true } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Insurance application not found.");
  return {
    id: row.id,
    productId: row.productId,
    quoteId: row.quoteId,
    providerName: row.provider.displayName,
    status: row.status,
    providerRef: row.providerRef,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    lastError: row.lastError,
    documentCount: 0,
    createdAt: row.createdAt.toISOString(),
    isSandbox: row.provider.mode === "SANDBOX",
  };
}

export async function listApplications(userId: string): Promise<InsuranceApplicationView[]> {
  const rows = await prisma.insuranceApplication.findMany({ where: { userId }, include: { provider: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => ({
    id: row.id, productId: row.productId, quoteId: row.quoteId, providerName: row.provider.displayName,
    status: row.status, providerRef: row.providerRef, submittedAt: row.submittedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null, lastError: row.lastError, documentCount: 0,
    createdAt: row.createdAt.toISOString(), isSandbox: row.provider.mode === "SANDBOX",
  }));
}

export async function createApplication(userId: string, input: InsuranceApplicationCreateInput): Promise<InsuranceApplicationView> {
  const product = await getProduct(input.productId);
  const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: product.providerId } });
  const existing = await prisma.insuranceApplication.findFirst({ where: { userId, idempotencyKey: input.idempotencyKey } });
  if (existing) return applicationView(existing.id, userId);

  const consent = await prisma.insuranceConsent.create({
    data: {
      userId,
      providerId: provider.id,
      purpose: "Insurance application submission",
      dataCategories: ["APPLICANT_INFORMATION"],
      sharedFields: Object.keys(input.applicantData),
      version: input.consentVersion,
    },
  });
  const row = await prisma.insuranceApplication.create({
    data: {
      userId,
      productId: product.id,
      quoteId: input.quoteId ?? null,
      providerId: provider.id,
      status: "DRAFT",
      idempotencyKey: input.idempotencyKey,
      applicantData: input.applicantData as object,
      consentId: consent.id,
    },
  });
  return applicationView(row.id, userId);
}

export async function submitApplication(userId: string, id: string): Promise<InsuranceApplicationView> {
  const row = await prisma.insuranceApplication.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Insurance application not found.");
  if (["SUBMITTED", "UNDER_REVIEW", "APPROVED", "COMPLETED", "POLICY_ISSUANCE_PENDING"].includes(row.status)) {
    return applicationView(id, userId); // replay-safe
  }
  if (!TRANSITIONS[row.status].includes("SUBMITTED")) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot submit an application in ${row.status}.`);
  }
  const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: row.providerId } });
  // Applicant data is shared with the provider only while an active consent exists.
  await requireActiveConsent(userId, row.providerId);
  const adapter = getInsurerAdapter(provider.code);
  const capability = await prisma.insuranceProviderCapability.findUnique({
    where: { providerId_capability: { providerId: provider.id, capability: "applications" } },
  });
  if ((capability && !capability.enabled) || !adapter.capabilities.applications) {
    throw new ApiError(409, "PAYMENT_ERROR", "This provider does not accept applications.");
  }

  const product = await prisma.insuranceProduct.findUniqueOrThrow({ where: { id: row.productId } });
  let result;
  try {
    result = await adapter.submitApplication({
      productCode: product.code,
      quoteRef: row.quoteId ?? undefined,
      applicant: row.applicantData as Record<string, unknown>,
      idempotencyKey: row.idempotencyKey,
    });
  } catch (error) {
    await prisma.insuranceApplication.update({
      where: { id }, data: { lastError: error instanceof Error ? error.message.slice(0, 500) : "Provider submission failed" },
    });
    throw error;
  }
  await prisma.$transaction(async (tx) => {
    await tx.insuranceApplication.update({
      where: { id },
      data: { status: "SUBMITTED", providerRef: result.providerRef, submittedAt: new Date(), lastError: null },
    });
  });
  await createNotification(prisma, {
    userId, type: "INSURANCE_APPLICATION_SUBMITTED",
    title: "Insurance application submitted",
    body: "Submission is not approval or coverage. We will notify you when the provider responds.",
    data: { applicationId: id },
  });
  return applicationView(id, userId);
}

export async function cancelApplication(userId: string, id: string): Promise<InsuranceApplicationView> {
  const row = await prisma.insuranceApplication.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Insurance application not found.");
  if (!TRANSITIONS[row.status].includes("CANCELLED")) {
    throw new ApiError(409, "PAYMENT_ERROR", "This application cannot be cancelled.");
  }
  await prisma.insuranceApplication.update({ where: { id }, data: { status: "CANCELLED" } });
  return applicationView(id, userId);
}

/** Only verified provider evidence may change application state. */
export async function applyVerifiedApplicationStatus(
  providerRef: string,
  target: InsuranceApplicationStatus,
  evidence: string,
): Promise<void> {
  const row = await prisma.insuranceApplication.findFirst({ where: { providerRef } });
  if (!row || !TRANSITIONS[row.status].includes(target)) return;
  await prisma.insuranceApplication.update({ where: { id: row.id }, data: { status: target } });
  await createNotification(prisma, {
    userId: row.userId,
    type: "INSURANCE_APPLICATION_STATUS_CHANGED",
    title: "Insurance application update",
    body: `Provider status: ${target.replaceAll("_", " ")}.`,
    data: { applicationId: row.id, evidence },
  });
}
