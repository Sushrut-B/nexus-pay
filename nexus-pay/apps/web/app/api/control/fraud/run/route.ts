import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { runSecurityEventWorker } from "@/lib/fraud/event-worker";
import { recordAdminAudit } from "@/lib/control/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:write"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);


    const result = await runSecurityEventWorker(100);
    await recordAdminAudit({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.roleName, action: "FRAUD_EVENT_WORKER_RUN", targetType: "security_event_outbox", targetId: "worker", requestId, outcome: "SUCCESS", metadata: result });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}


