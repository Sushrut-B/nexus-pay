import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { createManualCase } from "@/lib/fraud/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:write"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);

    const body = await readJsonBody(request);
    const input = body as { userId?: string; transactionRef?: string; riskScore: number; priority: string; reason: string };
    return jsonOk(await createManualCase({ ...input, actorId: admin.id }), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

