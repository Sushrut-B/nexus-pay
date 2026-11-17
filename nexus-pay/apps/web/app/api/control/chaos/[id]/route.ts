import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getChaosOperation } from "@/lib/control/chaos-service";
import { ApiError } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    await requireControl("chaos:read");
    const { id } = await context.params;
    const operation = await getChaosOperation(id);
    if (!operation) throw new ApiError(404, "PAYMENT_ERROR", "That chaos operation could not be found.");
    return jsonOk(operation, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
