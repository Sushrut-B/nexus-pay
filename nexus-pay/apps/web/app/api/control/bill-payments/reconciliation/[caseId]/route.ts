import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getReconciliationCase } from "@/lib/billing/billing-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const requestId = getRequestId(request);
  try {
    await requireControl("bill-payments:read");
    const { caseId } = await context.params;
    const item = await getReconciliationCase(caseId); if (!item) throw new ApiError(404, "PAYMENT_ERROR", "Case not found."); return jsonOk(item, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

