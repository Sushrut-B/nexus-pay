import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { pauseProvider } from "@/lib/investments/investment-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("investments:write"), request);

    const { code } = await context.params;
    return jsonOk(await pauseProvider(code, admin.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
