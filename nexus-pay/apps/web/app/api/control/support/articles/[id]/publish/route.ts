import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { z } from "zod";
import { publishNewVersion } from "@/lib/support/help-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ title: z.string().min(3).max(200), body: z.string().min(20).max(20000) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("support:write"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 15, 60000);
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    return jsonOk({ version: await publishNewVersion(admin.id, id, input) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
