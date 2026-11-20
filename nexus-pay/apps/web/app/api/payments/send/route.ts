import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getClientIp } from "@/lib/api/rate-limit";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { evaluatePaymentRisk, gatewayEnabled } from "@/lib/fraud/payment-gateway";
import { securityAudit } from "@/lib/fraud/audit-service";
import { sendPaymentSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(
      `payment-send:${auth.user.id}`,
      8,
      60 * 1000,
      "Too many payment attempts. Please wait before trying again.",
    );

    const input = sendPaymentSchema.parse(await readJsonBody(request));
    const recipientKey = createHash("sha256").update(input.recipientToken).digest("hex").slice(0, 24);

    // Release 13: read-only pre-transaction risk gate. It never creates a payment
    // intent, never mutates a wallet and never touches the Raftline ledger.
    if (gatewayEnabled()) {
      try {
        const decision = await evaluatePaymentRisk({
          userId: auth.user.id,
          amountMinor: input.amountMinor,
          recipientId: recipientKey,
          clientRequestId: input.clientRequestId,
          sessionId: auth.sessionId,
          deviceId: request.headers.get("x-device-id"),
          ipAddress: getClientIp(request),
          requestId,
        });
        if (!decision.allow) {
          throw new ApiError(403, "AUTHORIZATION_ERROR", decision.customerMessage ?? "Additional verification is required.", {
            evaluation: decision.evaluation.reference,
          });
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        await securityAudit({
          actorType: "SYSTEM", actorId: "payment-risk-gateway", action: "RISK_GATEWAY_UNAVAILABLE",
          targetType: "payment_intent", targetId: input.clientRequestId,
          metadata: { error: error instanceof Error ? error.message.slice(0, 200) : "gateway failure", fallback: "ALLOW_WITH_MONITORING" },
        });
      }
    }

    const created = await getOrCreatePaymentIntent(auth.user.id, input);

    await publishSecurityEvent({
      eventId: `pay_init_${created.id}`,
      type: "PAYMENT_INITIATED",
      occurredAt: new Date(),
      actorId: auth.user.id,
      subjectId: created.id,
      sessionId: auth.sessionId,
      sourceModule: "payments",
      correlationId: input.clientRequestId ?? undefined,
      transactionRef: input.clientRequestId,
      deviceId: request.headers.get("x-device-id"),
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: { amountMinor: input.amountMinor, currency: "INR", recipient: recipientKey },
    }, prisma, requestId);

    const final =
      created.status === "SETTLED" || created.status === "REJECTED"
        ? created
        : await executePaymentIntent(created.id, auth.user.id);

    return jsonOk(final, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
