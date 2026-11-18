import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { setCampaignStatus } from "@/lib/rewards/campaign-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("rewards:write"), request);
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as { reason?: string };
    if (!body.reason || body.reason.length < 5) {
      throw new ApiError(400, "VALIDATION_ERROR", "A rejection reason is required.");
    }
    return jsonOk(await setCampaignStatus(id, "REJECTED", body.reason, admin), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
