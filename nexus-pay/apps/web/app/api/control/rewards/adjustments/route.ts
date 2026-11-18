import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { manualAdjustment } from "@/lib/rewards/admin-service";
import { rewardAdjustmentSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("rewards:write"), request);
    const input = rewardAdjustmentSchema.parse(await readJsonBody(request));
    return jsonOk(await manualAdjustment(input, admin), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
