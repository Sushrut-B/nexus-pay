import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listAudit } from "@/lib/control/alert-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("audit:read");
    const action = request.nextUrl.searchParams.get("action") ?? undefined;
    const all = await listAudit(500);
    return jsonOk({ items: action ? all.filter((item) => item.action === action) : all }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
