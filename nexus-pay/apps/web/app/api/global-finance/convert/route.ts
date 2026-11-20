import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { globalConvertSchema } from "@nexus/validation";
import { convert } from "@/lib/global/fx-service";
import { publishGlobalSecurity } from "@/lib/global/global-audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 30, 60000);
    const input = globalConvertSchema.parse(await readJsonBody(request));
    const result = await convert({ ...input, asOf: input.asOf ? new Date(input.asOf) : undefined });
    await publishGlobalSecurity({ type: "GLOBAL_FX_CONVERSION_VIEWED", actorId: auth.user.id, subjectId: auth.user.id, metadata: { from: input.from, to: input.to } });
    return jsonOk(result, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
