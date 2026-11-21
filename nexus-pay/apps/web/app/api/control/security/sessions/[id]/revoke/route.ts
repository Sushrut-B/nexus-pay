import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { adminSecurityReasonSchema } from "@nexus/validation";
import { adminRevokeSession } from "@/lib/identity/security-overview-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("security:sessions"), request);
    enforceRateLimitOrThrow("security-control-write:" + admin.id, 20, 60000);
    const { id } = await context.params;
    const input = adminSecurityReasonSchema.parse(await readJsonBody(request));
    return jsonOk(await adminRevokeSession(admin.id, id, input.reason), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
