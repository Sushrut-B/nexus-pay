import { prisma, type LoanApplicationStatus } from "@nexus/database";
import type { ApplicationView } from "@nexus/shared-types";
import type { ApplicationCreateInput, ApplicationUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { getOffer } from "@/lib/credit/catalog-service";
import { getLenderAdapter } from "@/lib/credit/providers";

const TRANSITIONS: Record<LoanApplicationStatus, LoanApplicationStatus[]> = {
  DRAFT: ["READY_FOR_SUBMISSION", "SUBMITTED", "CANCELLED"],
  READY_FOR_SUBMISSION: ["SUBMITTED", "CANCELLED", "DRAFT"],
  SUBMITTED: ["ACKNOWLEDGED", "UNDER_REVIEW", "DISBURSED", "REJECTED", "CANCELLED"],
  ACKNOWLEDGED: ["UNDER_REVIEW", "OFFERED", "DISBURSED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["ADDITIONAL_INFORMATION_REQUIRED", "OFFERED", "APPROVED", "DISBURSED", "REJECTED", "CANCELLED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["UNDER_REVIEW", "WITHDRAWN", "CANCELLED"],
  APPROVED: ["OFFERED", "DISBURSEMENT_PENDING", "CANCELLED"],
  REJECTED: [],
  OFFERED: ["ACCEPTED", "EXPIRED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["DISBURSEMENT_PENDING", "CANCELLED"],
  DISBURSEMENT_PENDING: ["DISBURSED", "CANCELLED"],
  DISBURSED: [],
  WITHDRAWN: [],
  EXPIRED: [],
  CANCELLED: [],
};

function requireTransition(from: LoanApplicationStatus, to: LoanApplicationStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Invalid application transition ${from} -> ${to}.`);
  }
}

export async function applicationView(id: string, userId?: string): Promise<ApplicationView> {
  const row = await prisma.loanApplication.findFirst({
    where: { id, ...(userId ? { userId } : {}) },
    include: {
      provider: true,
      history: { orderBy: { createdAt: "asc" } },
      documents: true,
    },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan application not found.");
  return {
    id: row.id,
    offerId: row.offerId,
    productId: row.productId,
    providerId: row.providerId,
    providerName: row.provider.displayName,
    status: row.status,
    providerApplicationRef: row.providerApplicationRef,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    history: row.history.map((item) => ({
      from: item.fromStatus, to: item.toStatus, actor: item.actor,
      at: item.createdAt.toISOString(), evidence: item.evidence,
    })),
    documents: row.documents.filter((doc) => doc.status !== "DELETED").map((doc) => ({
      id: doc.id, category: doc.category, fileName: doc.fileName, status: doc.status,
    })),
    isSandbox: row.provider.mode === "SANDBOX",
  };
}

export async function listApplications(userId: string): Promise<ApplicationView[]> {
  const rows = await prisma.loanApplication.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return Promise.all(rows.map((row) => applicationView(row.id, userId)));
}

export async function createApplication(userId: string, input: ApplicationCreateInput): Promise<ApplicationView> {
  const offer = await getOffer(input.offerId);
  if (!offer.expiresAt || new Date(offer.expiresAt) <= new Date()) {
    throw new ApiError(409, "PAYMENT_ERROR", "This offer has expired.");
  }
  if (offer.isSandbox) {
    // Allowed only for clearly labelled sandbox development fixtures.
  }
  const existing = await prisma.loanApplication.findFirst({ where: { userId, idempotencyKey: input.idempotencyKey } });
  if (existing) return applicationView(existing.id, userId);

  const provider = await prisma.lendingProvider.findUniqueOrThrow({ where: { id: offer.providerId } });
  const product = await prisma.creditProduct.findUniqueOrThrow({ where: { id: offer.productId } });
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.loanApplication.create({
      data: {
        userId,
        offerId: offer.id,
        productId: product.id,
        providerId: provider.id,
        status: "DRAFT",
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.loanApplicantInformation.create({
      data: {
        applicationId: row.id,
        employmentCategory: input.employmentCategory,
        monthlyIncomeRange: input.monthlyIncomeRange,
        employmentMonths: input.employmentMonths,
        existingObligationsMinor: input.existingObligationsMinor,
        requestedAmountMinor: input.requestedAmountMinor,
        requestedTenureMonths: input.requestedTenureMonths,
        purpose: input.purpose,
      },
    });
    await tx.loanConsent.create({
      data: {
        applicationId: row.id,
        userId,
        purpose: "Loan application assessment and lender verification",
        disclosures: { accepted: true, sandboxNotice: offer.isSandbox ? "Sandbox fixture only" : null },
        dataShared: { declared: ["employment", "income range", "obligations", "purpose"], observed: [] },
        consentVersion: input.consentVersion,
      },
    });
    await tx.loanApplicationStatusHistory.create({
      data: { applicationId: row.id, toStatus: "DRAFT", actor: userId, reason: "Application created" },
    });
    return row;
  });
  return applicationView(created.id, userId);
}

export async function updateApplication(userId: string, id: string, input: ApplicationUpdateInput): Promise<ApplicationView> {
  const row = await prisma.loanApplication.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan application not found.");
  if (!["DRAFT", "READY_FOR_SUBMISSION", "ADDITIONAL_INFORMATION_REQUIRED"].includes(row.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This application can no longer be edited.");
  }
  await prisma.loanApplicantInformation.update({ where: { applicationId: id }, data: input });
  return applicationView(id, userId);
}

/** Submission is idempotent and never represents approval or disbursement. */
export async function submitApplication(userId: string, id: string): Promise<ApplicationView> {
  const row = await prisma.loanApplication.findFirst({ where: { id, userId }, include: { provider: true, applicant: true } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan application not found.");
  if (["SUBMITTED", "ACKNOWLEDGED", "UNDER_REVIEW", "OFFERED", "APPROVED", "ACCEPTED", "DISBURSEMENT_PENDING", "DISBURSED"].includes(row.status)) {
    return applicationView(id, userId); // replay: no second provider submission
  }
  requireTransition(row.status, "SUBMITTED");

  const adapter = getLenderAdapter(row.provider.code);
  const capability = await prisma.lendingProviderCapability.findUnique({
    where: { providerId_capability: { providerId: row.providerId, capability: "applicationSubmission" } },
  });
  if (capability && !capability.enabled) {
    throw new ApiError(409, "PAYMENT_ERROR", "This provider currently does not accept application submissions.");
  }
  if (!adapter.capabilities.applicationSubmission) {
    throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support application submission.");
  }
  let result;
  try {
    result = await adapter.submitApplication({
      idempotencyKey: row.idempotencyKey,
      productCode: (await prisma.creditProduct.findUniqueOrThrow({ where: { id: row.productId } })).code,
      offerRef: (await prisma.creditOffer.findUniqueOrThrow({ where: { id: row.offerId } })).providerOfferRef,
      applicant: {
        employmentCategory: row.applicant?.employmentCategory,
        monthlyIncomeRange: row.applicant?.monthlyIncomeRange,
        requestedAmountMinor: row.applicant?.requestedAmountMinor,
      },
    });
  } catch (error) {
    // A timeout or provider failure must not falsely mark the application submitted.
    await prisma.loanApplication.update({
      where: { id },
      data: { lastError: error instanceof Error ? error.message.slice(0, 500) : "Provider submission failed" },
    });
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.loanApplication.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        providerApplicationRef: result.providerApplicationRef,
        submittedAt: new Date(),
        lastError: null,
      },
    });
    await tx.loanApplicationStatusHistory.create({
      data: {
        applicationId: id, fromStatus: row.status, toStatus: "SUBMITTED",
        actor: userId, reason: "Submitted to provider", evidence: result.providerApplicationRef,
      },
    });
  });
  await createNotification(prisma, {
    userId, type: "CREDIT_APPLICATION_STATUS_CHANGED",
    title: "Application submitted", body: "Your loan application was submitted to the lender partner. This is not an approval.",
    data: { applicationId: id },
  });
  return applicationView(id, userId);
}

export async function withdrawApplication(userId: string, id: string): Promise<ApplicationView> {
  const row = await prisma.loanApplication.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan application not found.");
  if (!["DRAFT", "READY_FOR_SUBMISSION", "ADDITIONAL_INFORMATION_REQUIRED", "UNDER_REVIEW"].includes(row.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This application cannot be withdrawn.");
  }
  requireTransition(row.status, "WITHDRAWN");
  await prisma.$transaction(async (tx) => {
    await tx.loanApplication.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
    await tx.loanApplicationStatusHistory.create({
      data: { applicationId: id, fromStatus: row.status, toStatus: "WITHDRAWN", actor: userId, reason: "Withdrawn by customer" },
    });
  });
  return applicationView(id, userId);
}

/** Called only from verified provider events — never from an administrative route. */
export async function applyVerifiedApplicationStatus(
  providerApplicationRef: string,
  target: LoanApplicationStatus,
  evidence: string,
  reason?: string,
): Promise<void> {
  const row = await prisma.loanApplication.findFirst({ where: { providerApplicationRef } });
  if (!row) return;
  if (!TRANSITIONS[row.status].includes(target)) return;
  await prisma.$transaction(async (tx) => {
    await tx.loanApplication.update({
      where: { id: row.id },
      data: { status: target, decidedAt: ["APPROVED", "REJECTED", "OFFERED", "EXPIRED"].includes(target) ? new Date() : undefined },
    });
    await tx.loanApplicationStatusHistory.create({
      data: { applicationId: row.id, fromStatus: row.status, toStatus: target, actor: "PROVIDER_EVENT", reason: reason ?? null, evidence },
    });
  });
  await createNotification(prisma, {
    userId: row.userId, type: "CREDIT_APPLICATION_STATUS_CHANGED",
    title: "Loan application update", body: `Your application status is now ${target.replaceAll("_", " ")}.`,
    data: { applicationId: row.id },
  });
}
