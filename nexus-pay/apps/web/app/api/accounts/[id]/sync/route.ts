import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { enqueueSync } from "@/lib/accounts/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`accounts-sync:${user.id}`, 10, 60_000);
    const { id } = await context.params;
    const job = await enqueueSync(id, "INCREMENTAL_SYNC");
    return jsonOk({ jobId: job.id, status: job.status }, requestId, 202);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
