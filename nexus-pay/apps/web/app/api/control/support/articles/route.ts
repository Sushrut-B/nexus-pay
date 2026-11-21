import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { helpArticleSchema } from "@nexus/validation";
import { createArticle } from "@/lib/support/help-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("support:write"), request);
    enforceRateLimitOrThrow("support-control:" + admin.id, 15, 60000);
    const input = helpArticleSchema.parse(await readJsonBody(request));
    return jsonOk({ id: await createArticle(admin.id, input) }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
