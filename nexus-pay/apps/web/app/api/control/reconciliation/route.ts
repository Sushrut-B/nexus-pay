import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listReconciliationCases } from "@/lib/control/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("reconciliation:read");
    return jsonOk({ items: await listReconciliationCases() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
