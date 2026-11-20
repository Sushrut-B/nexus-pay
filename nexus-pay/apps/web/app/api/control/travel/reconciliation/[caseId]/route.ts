import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getTravelCase } from "@/lib/travel/travel-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const requestId = getRequestId(request);
  try {
    await requireControl("travel:read");
    const { caseId } = await context.params;
    const item = await getTravelCase(caseId); if (!item) throw new ApiError(404, "PAYMENT_ERROR", "Case not found."); return jsonOk(item, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
