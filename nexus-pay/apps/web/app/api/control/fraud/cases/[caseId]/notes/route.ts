import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { addCaseNote } from "@/lib/fraud/case-service";
import { caseNoteSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:write"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);
    const { caseId } = await context.params;
    const body = await readJsonBody(request);
    const input = caseNoteSchema.parse(body);
    return jsonOk(await addCaseNote(caseId, input.body, input.internal, admin.id), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

