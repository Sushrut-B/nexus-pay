import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { adminDeletionReviewSchema } from "@nexus/validation";
import { adminReviewDeletion } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("security:recovery"), request);
    enforceRateLimitOrThrow("security-control-write:" + admin.id, 20, 60000);
    const { id } = await context.params;
    const input = adminDeletionReviewSchema.parse(await readJsonBody(request));
    return jsonOk(await adminReviewDeletion(admin.id, id, input.decision, input.reason), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
