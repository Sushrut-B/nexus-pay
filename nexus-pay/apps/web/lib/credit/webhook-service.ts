import { prisma } from "@nexus/database";
import type { LoanApplicationStatus } from "@nexus/database";
import type { CreditWebhookInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getLenderAdapter } from "@/lib/credit/providers";
import { applyVerifiedApplicationStatus } from "@/lib/credit/application-service";
import { activateLoanFromProvider, confirmProviderRepayment } from "@/lib/credit/loan-service";

export async function receiveWebhook(providerCode: string, input: CreditWebhookInput): Promise<{ eventId: string; status: string }> {
  const provider = await prisma.lendingProvider.findUnique({ where: { code: providerCode } });
  if (!provider || provider.status !== "AVAILABLE") {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Lending provider is not configured.");
  }
  const adapter = getLenderAdapter(providerCode);
  if (!adapter.capabilities.webhooks) throw new ApiError(409, "PAYMENT_ERROR", "Provider does not support webhooks.");
  const rawBody = JSON.stringify(input.payload);
  const signatureValid = adapter.verifyWebhook({ signature: input.signature, timestamp: input.timestamp, rawBody });

  const existing = await prisma.lenderWebhookEvent.findUnique({
    where: { providerId_providerEventId: { providerId: provider.id, providerEventId: input.eventId } },
  });
  if (existing) {
    if (existing.status === "RECEIVED") await prisma.providerSyncJob.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT", status: "PENDING" } }).catch(() => undefined);
    return { eventId: existing.id, status: existing.status };
  }

  const event = await prisma.lenderWebhookEvent.create({
    data: {
      providerId: provider.id,
      eventType: input.eventType,
      providerEventId: input.eventId,
      payload: { ...input.payload, timestamp: input.timestamp } as object,
      signatureValid,
      status: "RECEIVED",
    },
  });
  if (signatureValid) {
    await prisma.providerSyncJob.create({
      data: { providerId: provider.id, kind: "WEBHOOK_EVENT", status: "PENDING" },
    });
  } else {
    await prisma.lenderWebhookEvent.update({
      where: { id: event.id }, data: { status: "FAILED", error: "Invalid provider signature" },
    });
  }
  return { eventId: event.id, status: event.status };
}

const EVENT_STATUS: Record<string, LoanApplicationStatus> = {
  APPLICATION_ACKNOWLEDGED: "ACKNOWLEDGED",
  ADDITIONAL_INFORMATION_REQUESTED: "ADDITIONAL_INFORMATION_REQUIRED",
  OFFER_ISSUED: "OFFERED",
  OFFER_EXPIRED: "EXPIRED",
  OFFER_ACCEPTED: "ACCEPTED",
  APPLICATION_STATUS_CHANGED: "UNDER_REVIEW",
};

/** Apply one verified event. Unverified payloads never change loan state. */
export async function processWebhookEvent(eventId: string): Promise<"processed" | "skipped"> {
  const event = await prisma.lenderWebhookEvent.findUnique({ where: { id: eventId }, include: { provider: true } });
  if (!event || event.status !== "RECEIVED" || !event.signatureValid) return "skipped";
  const payload = event.payload as Record<string, unknown>;
  const applicationRef = String(payload.applicationRef ?? payload.providerApplicationRef ?? "");
  const application = applicationRef
    ? await prisma.loanApplication.findFirst({ where: { providerApplicationRef: applicationRef } })
    : null;

  try {
    if (event.eventType === "LOAN_DISBURSED" && application) {
      await activateLoanFromProvider({
        userId: application.userId,
        applicationId: application.id,
        providerId: application.providerId,
        providerLoanRef: String(payload.loanRef ?? payload.providerLoanRef ?? event.providerEventId),
        principalMinor: Number(payload.principalMinor ?? 0),
        interestRateBps: Number(payload.interestRateBps ?? 0),
        aprBps: payload.aprBps === undefined ? undefined : Number(payload.aprBps),
        tenureMonths: Number(payload.tenureMonths ?? 12),
        emiMinor: Number(payload.emiMinor ?? 0),
        evidence: event.providerEventId,
      });
      await applyVerifiedApplicationStatus(application.providerApplicationRef ?? "", "DISBURSED", event.providerEventId, "Verified disbursement event");
    } else if (event.eventType === "REPAYMENT_CONFIRMED") {
      const loanRef = String(payload.loanRef ?? payload.providerLoanRef ?? "");
      const loan = await prisma.activeLoan.findFirst({ where: { providerLoanRef: loanRef } });
      if (loan) {
        await confirmProviderRepayment({
          loanId: loan.id,
          providerRef: String(payload.repaymentRef ?? event.providerEventId),
          amountMinor: Number(payload.amountMinor ?? 0),
          paidAt: new Date(String(payload.paidAt ?? new Date().toISOString())),
          evidence: event.providerEventId,
        });
      }
    } else if (application && EVENT_STATUS[event.eventType]) {
      await applyVerifiedApplicationStatus(
        application.providerApplicationRef ?? "",
        EVENT_STATUS[event.eventType]!,
        event.providerEventId,
        event.eventType,
      );
    }
    await prisma.lenderWebhookEvent.update({
      where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() },
    });
    return "processed";
  } catch (error) {
    await prisma.lenderWebhookEvent.update({
      where: { id: eventId },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" },
    });
    return "skipped";
  }
}

export async function runProviderSyncWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.providerSyncJob.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    const claimed = await prisma.providerSyncJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 300_000) },
    });
    if (claimed.count === 0) continue;
    try {
      if (job.kind === "WEBHOOK_EVENT") {
        const event = await prisma.lenderWebhookEvent.findFirst({
          where: { providerId: job.providerId, status: "RECEIVED", signatureValid: true },
          orderBy: { createdAt: "asc" },
        });
        if (event) await processWebhookEvent(event.id);
      }
      await prisma.providerSyncJob.update({ where: { id: job.id }, data: { status: "COMPLETED", leaseUntil: null } });
      processed += 1;
    } catch (error) {
      const dead = job.attempts + 1 >= 3;
      await prisma.providerSyncJob.update({
        where: { id: job.id },
        data: {
          status: dead ? "FAILED" : "PENDING", leaseUntil: null,
          error: error instanceof Error ? error.message.slice(0, 500) : "Sync failed",
          nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * (job.attempts + 1)),
        },
      });
    }
  }
  return { processed };
}
