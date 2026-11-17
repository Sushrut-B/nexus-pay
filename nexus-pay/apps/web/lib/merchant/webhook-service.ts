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

/** Claims due outbox events and delivers signed payloads. Safe for multiple workers. */
export async function runWebhookWorker(limit = 20): Promise<{ processed: number; delivered: number; failed: number }> {
  const due = await prisma.merchantWebhookEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    include: { merchant: true },
    orderBy: { availableAt: "asc" },
    take: limit,
  });
  const result = { processed: 0, delivered: 0, failed: 0 };
  for (const event of due) {
    const claimed = await prisma.merchantWebhookEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) continue;
    result.processed += 1;

    const endpoints = await prisma.merchantWebhookEndpoint.findMany({
      where: { merchantId: event.merchantId, enabled: true, events: { has: event.eventType } },
    });
    const timestamp = String(Date.now());
    const body = JSON.stringify({
      id: event.id,
      type: event.eventType,
      created_at: event.createdAt.toISOString(),
      data: event.payload,
    });

    for (const endpoint of endpoints) {
      const delivery = await prisma.merchantWebhookDelivery.create({
        data: { eventId: event.id, endpointId: endpoint.id, status: "PENDING" },
      });
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
        const ok = response.ok;
        await prisma.merchantWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: ok ? "DELIVERED" : "FAILED",
            responseCode: response.status,
            error: ok ? null : `HTTP ${response.status}`,
            deliveredAt: ok ? new Date() : null,
            nextAttemptAt: ok ? null : new Date(Date.now() + 60_000 * 2 ** delivery.attempt),
          },
        });
        if (ok) result.delivered += 1;
        else result.failed += 1;
      } catch (error) {
        const dead = delivery.attempt >= MAX_ATTEMPTS;
        await prisma.merchantWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: dead ? "DEAD_LETTER" : "FAILED",
            error: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
            nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * 2 ** delivery.attempt),
          },
        });
        result.failed += 1;
      }
    }

    await prisma.merchantWebhookEvent.update({
      where: { id: event.id },
      data: { status: "DELIVERED" },
    });
  }
  return result;
}

