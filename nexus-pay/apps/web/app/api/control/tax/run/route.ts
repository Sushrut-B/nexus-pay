import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { runTaxWorker } from "@/lib/tax/tax-worker-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    await requireControl("tax:write");

    return jsonOk(await runTaxWorker(25), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}


