import { prisma } from "@nexus/database";
import type { CreditOperationsView } from "@nexus/shared-types";

export async function getCreditOperations(): Promise<CreditOperationsView> {
  const [providers, products, offers, applications, submitted, callbacks, documents, loans, backlog] = await Promise.all([
    prisma.lendingProvider.count(),
    prisma.creditProduct.count({ where: { status: "ACTIVE" } }),
    prisma.creditOffer.count({ where: { status: "ACTIVE" } }),
    prisma.loanApplication.count(),
    prisma.loanApplication.count({ where: { status: { in: ["SUBMITTED", "ACKNOWLEDGED", "UNDER_REVIEW"] } } }),
    prisma.lenderWebhookEvent.count({ where: { status: "FAILED" } }),
    prisma.loanDocument.count({ where: { status: "FAILED" } }),
    prisma.activeLoan.count({ where: { status: "ACTIVE" } }),
    prisma.providerSyncJob.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
  ]);
  return {
    providers, products, activeOffers: offers, applications, submittedApplications: submitted,
    callbackFailures: callbacks, documentFailures: documents, loans, syncBacklog: backlog,
    currency: "INR",
  };
}

export async function listCreditApplications(limit = 100) {
  return prisma.loanApplication.findMany({
    include: { provider: true, applicant: true }, orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function listCreditEvents(limit = 100) {
  return prisma.lenderWebhookEvent.findMany({
    include: { provider: true }, orderBy: { createdAt: "desc" }, take: limit,
  });
}

export async function listCreditConsents(limit = 100) {
  return prisma.loanConsent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
