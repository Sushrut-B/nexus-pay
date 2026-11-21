import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { supportPrioritySchema } from "@nexus/validation";
import { setPriority } from "@/lib/support/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("support:write"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 20, 60000);
    const { id } = await context.params;
    const input = supportPrioritySchema.parse(await readJsonBody(request));
    return jsonOk(await setPriority(admin.id, id, input), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
