import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { setMerchantStatus } from "@/lib/merchant/merchant-service";
import { ApiError } from "@/lib/api/response";
import type { MerchantStatus } from "@nexus/shared-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("admin:write"), request);
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as { status?: MerchantStatus; reason?: string };
    const allowed: MerchantStatus[] = ["PENDING_REVIEW", "ACTIVE", "SUSPENDED", "CLOSED"];
    if (!body.status || !allowed.includes(body.status)) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid target status is required.");
    }
    return jsonOk(
      await setMerchantStatus(id, body.status, admin, body.reason ?? `Admin set status to ${body.status}`, requestId),
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
