import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { createInvestigation, listInvestigations } from "@/lib/rewards/admin-service";
import { rewardInvestigationCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("rewards:read");
    const status = request.nextUrl.searchParams.get("status") as never;
    return jsonOk({ items: await listInvestigations(status || undefined) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("rewards:write"), request);
    const input = rewardInvestigationCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createInvestigation(input, admin), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
