import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { resolveCase } from "@/lib/billing/billing-control-service";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("bill-payments:write"), request);
    enforceRateLimitOrThrow("billing-write:" + admin.id, 20, 60000);
    const { caseId } = await context.params;
    const body = await readJsonBody(request);
    const input = z.object({ resolution: z.string().min(5).max(1000), outcome: z.enum(["RESOLVED","CLOSED"]).default("RESOLVED") }).parse(body);
    return jsonOk(await resolveCase(caseId, input.resolution, input.outcome, admin.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

