import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listAlerts } from "@/lib/fraud/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");

    return jsonOk({ items: await listAlerts(request.nextUrl.searchParams.get("status") ?? undefined) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

