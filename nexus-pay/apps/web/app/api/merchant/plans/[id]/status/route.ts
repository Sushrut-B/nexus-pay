import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { setPlanStatus } from "@/lib/subscription/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as { status?: string };
    if (!body.status || !["DRAFT", "ACTIVE", "ARCHIVED"].includes(body.status)) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid plan status is required.");
    }
    return jsonOk(await setPlanStatus(user.id, id, body.status as "DRAFT" | "ACTIVE" | "ARCHIVED"), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
