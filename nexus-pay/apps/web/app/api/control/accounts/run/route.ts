import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { retryFailedJobs } from "@/lib/accounts/control-service";
import { runSyncWorker } from "@/lib/accounts/sync-service";
import { recordAdminAudit } from "@/lib/control/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("accounts:write"), request);
    enforceRateLimitOrThrow(`accounts-worker:${admin.id}`, 5, 60_000);
    const body = (await request.json().catch(() => ({}))) as { retryFailed?: boolean };
    const result = body.retryFailed
      ? await retryFailedJobs(admin.id)
      : await runSyncWorker(25);
    await recordAdminAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.roleName,
      action: "EXTERNAL_SYNC_WORKER_RUN",
      targetType: "account_sync_worker",
      targetId: "worker",
      requestId,
      outcome: "SUCCESS",
      metadata: result as object,
    });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
