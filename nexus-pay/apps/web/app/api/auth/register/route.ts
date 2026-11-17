import type { NextRequest } from "next/server";
import { registerSchema } from "@nexus/validation";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { registerCustomer } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(
      `register:${getClientIp(request)}`,
      5,
      10 * 60 * 1000,
      "Too many registration attempts. Please wait before trying again.",
    );

    const body = await readJsonBody(request);
    const input = registerSchema.parse(body);
    await registerCustomer(input, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return jsonOk({ redirectTo: "/onboarding" }, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
