import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getAlert } from "@/lib/fraud/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ alertId: string }> }) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");
    const { alertId } = await context.params;
    return jsonOk(await getAlert(alertId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

