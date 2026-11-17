import type { NextRequest } from "next/server";
import { loginSchema } from "@nexus/validation";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { authenticateCustomer } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const ip = getClientIp(request);
    enforceRateLimitOrThrow(
      `login-ip:${ip}`,
      20,
      5 * 60 * 1000,
      "Too many login attempts. Please wait before trying again.",
    );

    const body = await readJsonBody(request);
    const input = loginSchema.parse(body);
    enforceRateLimitOrThrow(
      `login-account:${input.identifier.trim().toLowerCase()}`,
      8,
      5 * 60 * 1000,
      "Too many login attempts for this account. Please wait before trying again.",
    );

    const result = await authenticateCustomer(
      input.identifier,
      input.password,
      Boolean(input.rememberMe),
      {
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
      },
    );

    return jsonOk(
      { redirectTo: result.onboardingComplete ? "/home" : "/onboarding" },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
