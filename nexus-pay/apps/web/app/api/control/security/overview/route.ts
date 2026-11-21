import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { getSecurityOperations } from "@/lib/identity/security-overview-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = withRequest(await requireControl("security:read"), request);
    enforceRateLimitOrThrow("security-control:" + admin.id, 30, 60000);
    const q = request.nextUrl.searchParams;
    return jsonOk(await getSecurityOperations({
      type: q.get("type") ?? undefined,
      actorId: q.get("actorId") ?? undefined,
      subjectId: q.get("subjectId") ?? undefined,
      from: q.get("from") ? new Date(String(q.get("from"))) : undefined,
      to: q.get("to") ? new Date(String(q.get("to"))) : undefined,
      limit: Number(q.get("limit") ?? 25),
      offset: Number(q.get("offset") ?? 0),
    }), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
