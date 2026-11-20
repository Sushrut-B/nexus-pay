import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getInvestmentOperations } from "@/lib/investments/investment-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {

    await requireControl("investments:read");

    return jsonOk(await getInvestmentOperations(), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
