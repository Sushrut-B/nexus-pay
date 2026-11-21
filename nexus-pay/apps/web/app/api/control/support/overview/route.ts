import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { getSupportOperations } from "@/lib/support/support-operations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = withRequest(await requireControl("support:read"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 30, 60000);
    const q = request.nextUrl.searchParams;
    return jsonOk(await getSupportOperations({
      status: q.get("status") ?? undefined,
      priority: q.get("priority") ?? undefined,
      category: q.get("category") ?? undefined,
      assignedTo: q.get("assignedTo") ?? undefined,
      limit: Number(q.get("limit") ?? 25),
      offset: Number(q.get("offset") ?? 0),
    }), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
