import type { NextRequest } from "next/server";
import { onboardingSchema } from "@nexus/validation";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { completeOnboarding } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(`onboarding:${auth.user.id}`, 10, 10 * 60 * 1000);

    const body = await readJsonBody(request);
    const input = onboardingSchema.parse(body);
    await completeOnboarding(auth.user.id, input);

    return jsonOk({ redirectTo: "/home" }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
