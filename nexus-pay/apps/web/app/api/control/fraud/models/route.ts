import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listModels, listModelEvaluations } from "@/lib/fraud/model-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");

    return jsonOk({ items: await listModels(), evaluations: await listModelEvaluations() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

