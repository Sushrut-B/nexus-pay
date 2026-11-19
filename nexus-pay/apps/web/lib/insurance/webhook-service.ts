import { prisma } from "@nexus/database";
import type { InsuranceApplicationStatus, InsuranceClaimStatus } from "@nexus/database";
import type { InsuranceWebhookInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getInsurerAdapter } from "@/lib/insurance/providers";
import { applyVerifiedApplicationStatus } from "@/lib/insurance/application-service";
import { createPolicyFromProvider } from "@/lib/insurance/policy-service";
import { applyVerifiedClaimStatus } from "@/lib/insurance/claim-service";

const APPLICATION_EVENTS: Record<string, InsuranceApplicationStatus> = {
  APPLICATION_SUBMITTED: "SUBMITTED",
  APPLICATION_UNDER_REVIEW: "UNDER_REVIEW",
  APPLICATION_ADDITIONAL_INFORMATION_REQUIRED: "ADDITIONAL_INFORMATION_REQUIRED",
  APPLICATION_APPROVED: "APPROVED",
  APPLICATION_REJECTED: "REJECTED",
  POLICY_ISSUANCE_PENDING: "POLICY_ISSUANCE_PENDING",
  APPLICATION_COMPLETED: "COMPLETED",
};

const CLAIM_EVENTS: Record<string, InsuranceClaimStatus> = {
  CLAIM_SUBMITTED: "SUBMITTED",
  CLAIM_UNDER_REVIEW: "UNDER_REVIEW",
  CLAIM_ADDITIONAL_INFORMATION_REQUIRED: "ADDITIONAL_INFORMATION_REQUIRED",
  CLAIM_APPROVED: "APPROVED",
  CLAIM_PARTIALLY_APPROVED: "PARTIALLY_APPROVED",
  CLAIM_REJECTED: "REJECTED",
  CLAIM_SETTLEMENT_PENDING: "SETTLEMENT_PENDING",
  CLAIM_SETTLED: "SETTLED",
  CLAIM_CLOSED: "CLOSED",
};

export async function receiveWebhook(providerCode: string, input: InsuranceWebhookInput) {
  const provider = await prisma.insuranceProvider.findUnique({ where: { code: providerCode } });
  if (!provider || provider.status !== "AVAILABLE") {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Insurer is not configured.");
  }
  const adapter = getInsurerAdapter(providerCode);
  if (!adapter.capabilities.webhooks) throw new ApiError(409, "PAYMENT_ERROR", "Provider does not support webhooks.");
  const rawBody = JSON.stringify(input.payload);
  const signatureValid = adapter.verifyWebhook({ signature: input.signature, timestamp: input.timestamp, rawBody });
  const payloadRef = typeof input.payload.providerRef === "string" ? input.payload.providerRef : null;
  const eventRef = input.providerRef ?? payloadRef ?? input.eventId;

  const existing = await prisma.insuranceProviderWebhook.findUnique({
    where: { providerId_eventId: { providerId: provider.id, eventId: input.eventId } },
  });
  if (existing) {
    if (existing.status === "RECEIVED") {
      await prisma.insuranceProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT", status: "PENDING" } }).catch(() => undefined);
    }
    return { eventId: existing.id, status: existing.status };
  }

  const event = await prisma.insuranceProviderWebhook.create({
    data: {
      providerId: provider.id,
      eventType: input.eventType,
      eventId: input.eventId,
      payload: { ...input.payload, timestamp: input.timestamp, providerRef: eventRef } as object,
      signatureValid,
      status: "RECEIVED",
    },
  });
  if (signatureValid) {
    await prisma.insuranceProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT", status: "PENDING" } });
    return { eventId: event.id, status: "RECEIVED" };
  }
  await prisma.insuranceProviderWebhook.update({
    where: { id: event.id }, data: { status: "FAILED", error: "Invalid provider signature" },
  });
  return { eventId: event.id, status: "FAILED" };
}

export async function processWebhookEvent(eventId: string): Promise<"processed" | "skipped"> {
  const event = await prisma.insuranceProviderWebhook.findUnique({ where: { id: eventId }, include: { provider: true } });
  if (!event || event.status !== "RECEIVED" || !event.signatureValid) return "skipped";
  const payload = event.payload as Record<string, unknown>;
  const providerRef = String(payload.providerRef ?? "");

  try {
    if (event.eventType === "POLICY_ISSUED") {
      const application = await prisma.insuranceApplication.findFirst({ where: { providerRef, providerId: event.providerId } });
      if (application) {
        const adapter = getInsurerAdapter(event.provider.code);
        const policy = await adapter.getPolicyDetails(providerRef);
        if (policy) {
          const product = await prisma.insuranceProduct.findUniqueOrThrow({ where: { id: application.productId } });
          await createPolicyFromProvider({
            userId: application.userId,
            applicationId: application.id,
            providerId: application.providerId,
            data: policy,
            category: product.category,
            evidence: event.eventId,
          });
          await applyVerifiedApplicationStatus(providerRef, "COMPLETED", event.eventId);
        }
      }
    } else if (APPLICATION_EVENTS[event.eventType]) {
      await applyVerifiedApplicationStatus(providerRef, APPLICATION_EVENTS[event.eventType]!, event.eventId);
    } else if (CLAIM_EVENTS[event.eventType]) {
      await applyVerifiedClaimStatus(providerRef, CLAIM_EVENTS[event.eventType]!, event.eventId);
    } else if (event.eventType === "RENEWAL_UPDATED") {
      await prisma.insuranceRenewal.updateMany({
        where: { providerRef },
        data: { quoteRef: payload.quoteRef ? String(payload.quoteRef) : undefined },
      });
    }
    await prisma.insuranceProviderWebhook.update({
      where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() },
    });
    return "processed";
  } catch (error) {
    await prisma.insuranceProviderWebhook.update({
      where: { id: eventId },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Processing failed" },
    });
    return "skipped";
  }
}

export async function runProviderSyncWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.insuranceProviderSync.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    const claimed = await prisma.insuranceProviderSync.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 300_000) },
    });
    if (claimed.count === 0) continue;
    try {
      if (job.kind === "WEBHOOK_EVENT") {
        const event = await prisma.insuranceProviderWebhook.findFirst({
          where: { providerId: job.providerId, status: "RECEIVED", signatureValid: true },
          orderBy: { createdAt: "asc" },
        });
        if (event) await processWebhookEvent(event.id);
      }
      await prisma.insuranceProviderSync.update({ where: { id: job.id }, data: { status: "COMPLETED", leaseUntil: null } });
      processed += 1;
    } catch (error) {
      const dead = job.attempts + 1 >= 3;
      await prisma.insuranceProviderSync.update({
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
