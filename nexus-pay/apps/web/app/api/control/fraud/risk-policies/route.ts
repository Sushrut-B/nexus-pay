import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listPolicies } from "@/lib/fraud/control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");

    return jsonOk({ items: await listPolicies() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

