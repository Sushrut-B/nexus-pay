import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { z } from "zod";
import { pauseProvider } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["fx", "international"]), paused: z.boolean() });

export async function POST(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("global:write"), request);
    enforceRateLimitOrThrow("global-control:" + admin.id, 15, 60000);
    const { code } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    await pauseProvider(admin.id, input.kind, code, input.paused);
    return jsonOk({ code, paused: input.paused }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
