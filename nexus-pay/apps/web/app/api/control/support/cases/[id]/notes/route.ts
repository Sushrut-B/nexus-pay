import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { supportInternalNoteSchema } from "@nexus/validation";
import { addInternalNote } from "@/lib/support/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("support:write"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 20, 60000);
    const { id } = await context.params;
    const input = supportInternalNoteSchema.parse(await readJsonBody(request));
    return jsonOk({ id: await addInternalNote(admin.id, id, input) }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
