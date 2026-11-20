import { prisma } from "@nexus/database";
import type { TravelWebhookInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getTravelAdapter } from "@/lib/travel/providers";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

const LEASE_MS = 300_000;
const MAX_ATTEMPTS = 3;

export async function receiveTravelWebhook(providerCode: string, input: TravelWebhookInput) {
  const provider = await prisma.travelProvider.findUnique({ where: { code: providerCode } });
  if (!provider || provider.status !== "AVAILABLE") throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Travel provider is not configured.");
  const adapter = getTravelAdapter(providerCode);
  if (!adapter.capabilities.webhooks) throw new ApiError(409, "PAYMENT_ERROR", "Provider does not support webhooks.");
  const rawBody = JSON.stringify(input.payload);
  const signatureValid = adapter.verifyWebhook({ signature: input.signature, timestamp: input.timestamp, rawBody });
  const existing = await prisma.travelProviderWebhook.findUnique({
    where: { providerId_eventId: { providerId: provider.id, eventId: input.eventId } },
  });
  if (existing) {
    if (existing.status === "RECEIVED") {
      await prisma.travelProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT" } }).catch(() => undefined);
    }
    return { eventId: existing.id, status: existing.status };
  }
  const event = await prisma.travelProviderWebhook.create({
    data: {
      providerId: provider.id, eventType: input.eventType, eventId: input.eventId,
      payload: { ...input.payload, timestamp: input.timestamp, providerRef: input.providerRef ?? null } as object,
      signatureValid, status: "RECEIVED",
    },
  });
  if (signatureValid) {
    await prisma.travelProviderSync.create({ data: { providerId: provider.id, kind: "WEBHOOK_EVENT" } });
  } else {
    await prisma.travelProviderWebhook.update({ where: { id: event.id }, data: { status: "FAILED", error: "Invalid provider signature" } });
  }
  return { eventId: event.id, status: signatureValid ? "RECEIVED" : "FAILED" };
}

export async function processTravelWebhook(eventId: string): Promise<"processed" | "skipped"> {
  const event = await prisma.travelProviderWebhook.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "RECEIVED" || !event.signatureValid) return "skipped";
  const payload = event.payload as Record<string, unknown>;
  const providerRef = String(payload.providerRef ?? "");
  try {
    if (providerRef) {
      const booking = await prisma.travelBooking.findFirst({ where: { providerRef } });
      const status = String(payload.status ?? "");
      if (booking && (status === "CONFIRMED" || status === "TICKET_ISSUED")) {
        await prisma.travelBooking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
        await prisma.travelBookingStatusHistory.create({
          data: { bookingId: booking.id, toStatus: "CONFIRMED", actor: "provider", evidence: event.eventId },
        });
      }
    }
    await prisma.travelProviderWebhook.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() } });
    await publishSecurityEvent({
      eventId: `travel_webhook_${event.id}`, type: "PROVIDER_WEBHOOK_RECEIVED", occurredAt: new Date(),
      subjectId: providerRef, sourceModule: "travel", metadata: { eventType: event.eventType, verified: true },
    });
    return "processed";
  } catch {
    await prisma.travelProviderWebhook.update({ where: { id: eventId }, data: { status: "FAILED", error: "Processing failed" } });
    return "skipped";
  }
}

export async function runTravelSyncWorker(limit = 25): Promise<{ processed: number }> {
  const jobs = await prisma.travelProviderSync.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let processed = 0;
  for (const job of jobs) {
    const claimed = await prisma.travelProviderSync.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count === 0) continue;
    try {
      if (job.kind === "WEBHOOK_EVENT") {
        const event = await prisma.travelProviderWebhook.findFirst({
          where: { providerId: job.providerId, status: "RECEIVED", signatureValid: true },
          orderBy: { createdAt: "asc" },
        });
        if (event) await processTravelWebhook(event.id);
      }
      await prisma.travelProviderSync.update({ where: { id: job.id }, data: { status: "COMPLETED", leaseUntil: null } });
      processed += 1;
    } catch (error) {
      const dead = job.attempts + 1 >= MAX_ATTEMPTS;
      await prisma.travelProviderSync.update({
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
