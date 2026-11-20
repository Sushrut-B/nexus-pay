import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { publishRuleSet } from "@/lib/tax/tax-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ version: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("tax:write"), request);
    const { version } = await context.params;
    return jsonOk(await publishRuleSet(version, admin.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
