import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { authenticateAdmin } from "@/lib/control/auth";
import { adminLoginSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const ip = getClientIp(request);
    enforceRateLimitOrThrow(`control-login-ip:${ip}`, 10, 5 * 60 * 1000, "Too many administrator login attempts.");
    const input = adminLoginSchema.parse(await readJsonBody(request));
    enforceRateLimitOrThrow(
      `control-login-account:${input.identifier.toLowerCase()}`,
      6,
      5 * 60 * 1000,
      "Too many attempts for this administrator account.",
    );
    const auth = await authenticateAdmin(input.identifier, input.password, {
      ip,
      userAgent: request.headers.get("user-agent"),
      requestId,
    });
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Administrator credentials are incorrect.");
    return jsonOk({ role: auth.admin.role, displayName: auth.admin.email }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
