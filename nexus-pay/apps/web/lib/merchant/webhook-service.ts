import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@nexus/database";
import type { WebhookEventType, WebhookEndpointView, WebhookDeliveryView } from "@nexus/shared-types";
import type { WebhookCreateInput, WebhookUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { isProduction } from "@/lib/env";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = signPayload(secret, timestamp, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createWebhookEvent(
  merchantId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<string> {
  const event = await prisma.merchantWebhookEvent.create({
    data: {
      merchantId,
      eventType,
      payload: payload as object,
      status: "PENDING",
      availableAt: new Date(),
    },
  });
  return event.id;
}

export async function createEndpoint(userId: string, input: WebhookCreateInput): Promise<WebhookEndpointView & { signingSecret: string }> {
  const merchant = await requireMerchantForUser(userId);
  if (isProduction() && !input.url.startsWith("https://")) {
    throw new ApiError(400, "VALIDATION_ERROR", "Production webhook endpoints must use HTTPS.");
  }
  const signingSecret = randomBytes(32).toString("hex");
  const endpoint = await prisma.merchantWebhookEndpoint.create({
    data: {
      merchantId: merchant.id,
      url: input.url,
      events: [...input.events],
      signingSecret,
    },
  });
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt.toISOString(),
    signingSecret,
  };
}

export async function listEndpoints(userId: string): Promise<WebhookEndpointView[]> {
  const merchant = await requireMerchantForUser(userId);
  const endpoints = await prisma.merchantWebhookEndpoint.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt.toISOString(),
  }));
}

export async function updateEndpoint(userId: string, id: string, input: WebhookUpdateInput): Promise<WebhookEndpointView> {
  const merchant = await requireMerchantForUser(userId);
  const endpoint = await prisma.merchantWebhookEndpoint.findFirst({ where: { id, merchantId: merchant.id } });
  if (!endpoint) throw new ApiError(404, "AUTHORIZATION_ERROR", "Webhook endpoint not found.");
  if (input.url && isProduction() && !input.url.startsWith("https://")) {
    throw new ApiError(400, "VALIDATION_ERROR", "Production webhook endpoints must use HTTPS.");
  }
  const updated = await prisma.merchantWebhookEndpoint.update({
    where: { id },
    data: {
      url: input.url,
      events: input.events ? [...input.events] : undefined,
      enabled: input.enabled,
    },
  });
  return {
    id: updated.id,
    url: updated.url,
    events: updated.events,
    enabled: updated.enabled,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function deleteEndpoint(userId: string, id: string): Promise<void> {
  const merchant = await requireMerchantForUser(userId);
  const endpoint = await prisma.merchantWebhookEndpoint.findFirst({ where: { id, merchantId: merchant.id } });
  if (!endpoint) throw new ApiError(404, "AUTHORIZATION_ERROR", "Webhook endpoint not found.");
  await prisma.merchantWebhookEndpoint.delete({ where: { id } });
}

export async function rotateEndpointSecret(userId: string, id: string): Promise<{ signingSecret: string }> {
  const merchant = await requireMerchantForUser(userId);
  const endpoint = await prisma.merchantWebhookEndpoint.findFirst({ where: { id, merchantId: merchant.id } });
  if (!endpoint) throw new ApiError(404, "AUTHORIZATION_ERROR", "Webhook endpoint not found.");
  const signingSecret = randomBytes(32).toString("hex");
  await prisma.merchantWebhookEndpoint.update({ where: { id }, data: { signingSecret } });
  return { signingSecret };
}

export async function queueTestEvent(userId: string, id: string): Promise<{ eventId: string }> {
  const merchant = await requireMerchantForUser(userId);
  const endpoint = await prisma.merchantWebhookEndpoint.findFirst({ where: { id, merchantId: merchant.id } });
  if (!endpoint) throw new ApiError(404, "AUTHORIZATION_ERROR", "Webhook endpoint not found.");
  const eventId = await createWebhookEvent(merchant.id, "payment.created", {
    test: true,
    message: "Nexus Pay webhook test event",
  });
  return { eventId };
}

export async function listDeliveries(userId: string, endpointId?: string): Promise<WebhookDeliveryView[]> {
  const merchant = await requireMerchantForUser(userId);
  const deliveries = await prisma.merchantWebhookDelivery.findMany({
    where: {
      endpoint: { merchantId: merchant.id, ...(endpointId ? { id: endpointId } : {}) },
    },
    include: { event: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return deliveries.map((delivery) => ({
    id: delivery.id,
    eventId: delivery.eventId,
    eventType: delivery.event.eventType,
    attempt: delivery.attempt,
    status: delivery.status,
    responseCode: delivery.responseCode,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  }));
}

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

function eventBody(event: { id: string; eventType: string; createdAt: Date; payload: unknown }): string {
  return JSON.stringify({
    id: event.id,
    type: event.eventType,
    created_at: event.createdAt.toISOString(),
    data: event.payload,
  });
}

function toDeliveryView(delivery: {
  id: string; eventId: string; attempt: number; status: string; responseCode: number | null;
  error: string | null; createdAt: Date; deliveredAt: Date | null; event: { eventType: string };
}): WebhookDeliveryView {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    eventType: delivery.event.eventType,
    attempt: delivery.attempt,
    status: delivery.status,
    responseCode: delivery.responseCode,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}

/** Deliver one claimed delivery with a fresh signature; never touches settlement. */
async function deliverOne(
  deliveryId: string,
  event: { id: string; eventType: string; createdAt: Date; payload: unknown },
  endpoint: { url: string; signingSecret: string },
): Promise<"DELIVERED" | "FAILED" | "DEAD_LETTER"> {
  const timestamp = String(Date.now());
  const body = eventBody(event);
  let ok = false;
  let responseCode: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexus-Event-Id": event.id,
        "X-Nexus-Timestamp": timestamp,
        "X-Nexus-Signature": signPayload(endpoint.signingSecret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    ok = response.ok;
    responseCode = response.status;
    if (!ok) error = `HTTP ${response.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 500) : "Delivery failed";
  }

  const current = await prisma.merchantWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const attempt = current.attempt + 1;
  const dead = !ok && attempt >= MAX_ATTEMPTS;
  await prisma.merchantWebhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: ok ? "DELIVERED" : dead ? "DEAD_LETTER" : "FAILED",
      attempt,
      responseCode,
      error: ok ? null : error,
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: ok || dead ? null : new Date(Date.now() + 60_000 * 2 ** (attempt - 1)),
    },
  });
  return ok ? "DELIVERED" : dead ? "DEAD_LETTER" : "FAILED";
}

async function finalizeEventIfSettled(eventId: string): Promise<void> {
  const outstanding = await prisma.merchantWebhookDelivery.count({
    where: { eventId, status: { in: ["PENDING", "FAILED", "RETRY_PENDING"] } },
  });
  if (outstanding > 0) return;
  const deadLettered = await prisma.merchantWebhookDelivery.count({
    where: { eventId, status: "DEAD_LETTER" },
  });
  await prisma.merchantWebhookEvent.update({
    where: { id: eventId },
    data: { status: deadLettered > 0 ? "DEAD_LETTER" : "DELIVERED" },
  });
}

/**
 * Two-phase outbox worker. Phase 1 fans PENDING events into durable delivery
 * rows (never delivered inline with settlement). Phase 2 claims deliveries due
 * for attempt/retry and delivers them with exponential backoff. The
 * RETRY_PENDING status doubles as a short lease so a crash does not lose work.
 */
export async function runWebhookWorker(limit = 20): Promise<{ processed: number; delivered: number; failed: number }> {
  const now = new Date();
  const result = { processed: 0, delivered: 0, failed: 0 };

  // Phase 1 — outbox fan-out.
  const dueEvents = await prisma.merchantWebhookEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: now } },
    include: { merchant: true },
    orderBy: { availableAt: "asc" },
    take: limit,
  });
  for (const event of dueEvents) {
    const claimed = await prisma.merchantWebhookEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: { status: "DISPATCHED" },
    });
    if (claimed.count === 0) continue;
    result.processed += 1;

    const endpoints = await prisma.merchantWebhookEndpoint.findMany({
      where: { merchantId: event.merchantId, enabled: true, events: { has: event.eventType } },
    });
    if (endpoints.length === 0) {
      await prisma.merchantWebhookEvent.update({ where: { id: event.id }, data: { status: "DELIVERED" } });
      continue;
    }
    for (const endpoint of endpoints) {
      await prisma.merchantWebhookDelivery.create({
        data: {
          eventId: event.id,
          endpointId: endpoint.id,
          status: "PENDING",
          attempt: 0,
          nextAttemptAt: new Date(),
        },
      });
    }
  }

  // Phase 2 — attempts and retries. Picks up both brand-new and backed-off deliveries.
  const dueDeliveries = await prisma.merchantWebhookDelivery.findMany({
    where: {
      status: { in: ["PENDING", "FAILED", "RETRY_PENDING"] },
      nextAttemptAt: { lte: new Date() },
      attempt: { lt: MAX_ATTEMPTS },
      endpoint: { enabled: true },
    },
    include: { event: true, endpoint: true },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  for (const delivery of dueDeliveries) {
    const claimed = await prisma.merchantWebhookDelivery.updateMany({
      where: {
        id: delivery.id,
        status: { in: ["PENDING", "FAILED", "RETRY_PENDING"] },
        nextAttemptAt: { lte: new Date() },
      },
      data: { status: "RETRY_PENDING", nextAttemptAt: new Date(Date.now() + LOCK_MS) },
    });
    if (claimed.count === 0) continue;

    const outcome = await deliverOne(delivery.id, delivery.event, delivery.endpoint);
    if (outcome === "DELIVERED") result.delivered += 1;
    else result.failed += 1;
    await finalizeEventIfSettled(delivery.eventId);
  }
  return result;
}

/** Authorized manual retry: reset a failed/dead-lettered delivery for redelivery. */
export async function retryDelivery(userId: string, deliveryId: string): Promise<WebhookDeliveryView> {
  const merchant = await requireMerchantForUser(userId);
  const delivery = await prisma.merchantWebhookDelivery.findFirst({
    where: { id: deliveryId, endpoint: { merchantId: merchant.id } },
    include: { event: true },
  });
  if (!delivery) throw new ApiError(404, "AUTHORIZATION_ERROR", "Webhook delivery not found.");
  const updated = await prisma.merchantWebhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "PENDING",
      attempt: 0,
      nextAttemptAt: new Date(),
      error: null,
      responseCode: null,
      deliveredAt: null,
    },
    include: { event: true },
  });
  return toDeliveryView(updated);
}

