import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { runWebhookWorker } from "@/lib/merchant/webhook-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`webhook-run:${user.id}`, 5, 60_000);
    return jsonOk(await runWebhookWorker(25), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
