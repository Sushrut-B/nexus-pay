import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { recordAdminAudit } from "@/lib/control/audit";
import { runProviderSyncWorker } from "@/lib/credit/webhook-service";
import { syncCatalog } from "@/lib/credit/catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("credit:write"), request);
    enforceRateLimitOrThrow(`credit-worker:${admin.id}`, 5, 60_000);
    const result = { ...(await runProviderSyncWorker(25)), ...(await syncCatalog()) };
    await recordAdminAudit({
      actorId: admin.id, actorEmail: admin.email, actorRole: admin.roleName,
      action: "CREDIT_PROVIDER_SYNC_RUN", targetType: "credit_provider", targetId: "worker",
      requestId, outcome: "SUCCESS", metadata: result as object,
    });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
