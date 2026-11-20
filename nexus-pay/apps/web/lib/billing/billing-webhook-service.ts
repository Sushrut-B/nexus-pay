import { randomUUID } from "node:crypto";
import { prisma } from "@nexus/database";
import type { BillWebhookInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getBillerAdapter } from "@/lib/billing/providers";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

/** Verifies, deduplicates and persists provider callbacks. Never trusts unsigned events. */
export async function receiveBillWebhook(providerCode: string, input: BillWebhookInput) {
  const provider = await prisma.billPaymentProvider.findUnique({ where: { code: providerCode } });
  if (!provider || provider.status !== "AVAILABLE") throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Bill payment provider is not configured.");
  const adapter = getBillerAdapter(providerCode);
  if (!adapter.capabilities.webhooks) throw new ApiError(409, "PAYMENT_ERROR", "Provider does not support webhooks.");
  const rawBody = JSON.stringify(input.payload);
  const signatureValid = adapter.verifyWebhook({ signature: input.signature, timestamp: input.timestamp, rawBody });
  const existing = await prisma.billProviderWebhook.findUnique({
    where: { providerId_eventId: { providerId: provider.id, eventId: input.eventId } },
  });
  if (existing) {
    if (existing.status === "RECEIVED") {
      await prisma.billProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT" } }).catch(() => undefined);
    }
    return { eventId: existing.id, status: existing.status };
  }
  const event = await prisma.billProviderWebhook.create({
    data: {
      providerId: provider.id, eventType: input.eventType, eventId: input.eventId,
      payload: { ...input.payload, timestamp: input.timestamp, providerRef: input.providerRef ?? null } as object,
      signatureValid, status: "RECEIVED",
    },
  });
  if (signatureValid) {
    await prisma.billProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT" } });
  } else {
    await prisma.billProviderWebhook.update({ where: { id: event.id }, data: { status: "FAILED", error: "Invalid provider signature" } });
  }
  return { eventId: event.id, status: signatureValid ? "RECEIVED" : "FAILED" };
}

/** Applies only verified status transitions to the correct provider transaction. */
export async function processBillWebhook(eventId: string): Promise<"processed" | "skipped"> {
  const event = await prisma.billProviderWebhook.findUnique({ where: { id: eventId }, include: { provider: true } });
  if (!event || event.status !== "RECEIVED" || !event.signatureValid) return "skipped";
  const payload = event.payload as Record<string, unknown>;
  const providerRef = String(payload.providerRef ?? "");
  try {
    if (providerRef) {
      const transaction = await prisma.billProviderTransaction.findFirst({ where: { providerRef } });
      if (transaction) {
        const status = String(payload.status ?? "");
        await prisma.billProviderTransaction.create({
          data: { paymentId: transaction.paymentId, providerRef: `${providerRef}:${event.eventId}`, status, payload: payload as object },
        }).catch(() => undefined);
        if (status === "BILLER_CONFIRMED" || status === "SUCCESS") {
          await prisma.billPaymentIntent.update({ where: { id: transaction.paymentId }, data: { status: "BILLER_CONFIRMED", confirmedAt: new Date() } });
        }
      }
    }
    await prisma.billProviderWebhook.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() } });
    await publishSecurityEvent({
      eventId: `bill_webhook_${event.id}`, type: "PROVIDER_WEBHOOK_RECEIVED", occurredAt: new Date(),
      subjectId: providerRef, sourceModule: "billing", metadata: { eventType: event.eventType, verified: true },
    });
    return "processed";
  } catch {
    await prisma.billProviderWebhook.update({ where: { id: eventId }, data: { status: "FAILED", error: "Processing failed" } });
    return "skipped";
  }
}

const LEASE_MS = 300_000;
const MAX_ATTEMPTS = 3;

export async function runBillSyncWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.billProviderSync.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    const claimed = await prisma.billProviderSync.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    try {
      if (job.kind === "WEBHOOK_EVENT") {
        const event = await prisma.billProviderWebhook.findFirst({
          where: { providerId: job.providerId, status: "RECEIVED", signatureValid: true },
          orderBy: { createdAt: "asc" },
        });
        if (event) await processBillWebhook(event.id);
      }
      await prisma.billProviderSync.update({ where: { id: job.id }, data: { status: "COMPLETED", leaseUntil: null } });
      processed += 1;
    } catch (error) {
      const dead = job.attempts + 1 >= MAX_ATTEMPTS;
      await prisma.billProviderSync.update({
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

export function newBillCorrelationId() { return `billcor_${randomUUID()}`; }
