import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { runInvestmentWorker } from "@/lib/investments/investment-control-service";
import { recordAdminAudit } from "@/lib/control/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("investments:write"), request);


    const result = await runInvestmentWorker();
    await recordAdminAudit({ actorId: admin.id, actorEmail: admin.email, actorRole: admin.roleName, action: "INVESTMENT_WORKER_RUN", targetType: "investment_sync_job", targetId: "worker", requestId, outcome: "SUCCESS", metadata: result });
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
