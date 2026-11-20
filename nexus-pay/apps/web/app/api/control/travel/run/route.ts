import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { runTravelWorker } from "@/lib/travel/travel-control-service";
import { recordAdminAudit } from "@/lib/control/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("travel:write"), request);
    enforceRateLimitOrThrow("travel-admin:" + admin.id, 20, 60000);

    const result = await runTravelWorker();
    await recordAdminAudit({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.roleName, action: "TRAVEL_WORKER_RUN", targetType: "travel_provider_sync", targetId: "worker", requestId, outcome: "SUCCESS", metadata: result });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
