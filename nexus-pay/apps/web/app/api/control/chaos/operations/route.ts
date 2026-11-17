import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listChaosOperations } from "@/lib/control/chaos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("chaos:read");
    return jsonOk({ items: await listChaosOperations() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
