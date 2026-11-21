import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { getStaffCaseDetail } from "@/lib/support/support-operations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const admin = withRequest(await requireControl("support:read"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 30, 60000);
    const { id } = await context.params;
    return jsonOk(await getStaffCaseDetail(id), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
