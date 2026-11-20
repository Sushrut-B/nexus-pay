import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { receiveInternationalWebhook } from "@/lib/global/international-payment-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider webhook receiver. Signature verification and de-duplication only. */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow("global-webhook", 120, 60000);
    const body = await readJsonBody(request) as {
      providerCode?: string; eventId?: string; payload?: object; signature?: string;
    };
    if (!body.providerCode || !body.eventId || !body.payload || !body.signature) {
      return jsonOk({ error: "Missing providerCode, eventId, payload or signature" }, requestId, 400);
    }
    return jsonOk(await receiveInternationalWebhook({
      providerCode: body.providerCode, eventId: body.eventId,
      payload: body.payload, signature: body.signature,
    }), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
