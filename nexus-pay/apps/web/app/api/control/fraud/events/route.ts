import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listSecurityEvents } from "@/lib/fraud/event-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");

    const p = Number(request.nextUrl.searchParams.get("page") ?? "1");
    return jsonOk(await listSecurityEvents({ page: p, pageSize: 20, type: request.nextUrl.searchParams.get("type") ?? undefined }), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

