import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { z } from "zod";
import { openSecurityIncident } from "@/lib/identity/security-overview-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  subjectUserId: z.string().min(2).max(80),
  type: z.string().min(2).max(60),
  summary: z.string().min(5).max(1000),
  severity: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("security:incidents"), request);
    enforceRateLimitOrThrow("security-control-write:" + admin.id, 20, 60000);
    const input = schema.parse(await readJsonBody(request));
    return jsonOk({ id: await openSecurityIncident({ ...input, actorId: admin.id }) }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
