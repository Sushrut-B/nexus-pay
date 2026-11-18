import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { runFinanceWorker } from "@/lib/finance-intelligence/worker-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = await requireControl("finance:write");
    enforceRateLimitOrThrow(`finance-worker:${admin.id}`, 5, 60_000);
    return jsonOk(await runFinanceWorker(), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
