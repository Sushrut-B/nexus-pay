import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getFinanceOperations } from "@/lib/finance-intelligence/worker-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("finance:read");
    return jsonOk(await getFinanceOperations(), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
