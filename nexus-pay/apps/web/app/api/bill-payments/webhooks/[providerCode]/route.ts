import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { receiveBillWebhook } from "@/lib/billing/billing-webhook-service";
import { billWebhookSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ providerCode: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`bill-webhook:${getClientIp(request)}`, 60, 60_000);
    const { providerCode } = await context.params;
    const input = billWebhookSchema.parse(await readJsonBody(request));
    return jsonOk(await receiveBillWebhook(providerCode, input), requestId, 202);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
