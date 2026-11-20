import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { runBillSyncWorker } from "@/lib/billing/billing-webhook-service";
import { runReminderWorker } from "@/lib/billing/recurring-service";
import { recordAdminAudit } from "@/lib/control/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("bill-payments:write"), request);
    enforceRateLimitOrThrow("billing-write:" + admin.id, 20, 60000);


    const result = { ...(await runBillSyncWorker(25)), ...(await runReminderWorker(50)) };
    await recordAdminAudit({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.roleName, action: "BILL_PAYMENT_WORKER_RUN", targetType: "bill_provider_sync", targetId: "worker", requestId, outcome: "SUCCESS", metadata: result });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

