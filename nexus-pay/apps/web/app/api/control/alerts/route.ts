import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listAlerts } from "@/lib/control/alert-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("alerts:read");
    const status = request.nextUrl.searchParams.get("status");
    const items = await listAlerts(
      ["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status ?? "") ? (status as "OPEN" | "ACKNOWLEDGED" | "RESOLVED") : undefined,
    );
    return jsonOk({ items }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
