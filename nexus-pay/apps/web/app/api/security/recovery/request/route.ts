import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { accountRecoveryRequestSchema } from "@nexus/validation";
import { requestAccountRecovery } from "@/lib/identity/recovery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const ip = getClientIp(request);
    enforceRateLimitOrThrow(`recovery-ip:${ip}`, 5, 15 * 60_000, "Too many recovery requests.");
    const input = accountRecoveryRequestSchema.parse(await readJsonBody(request));
    enforceRateLimitOrThrow(`recovery-account:${input.email.trim().toLowerCase()}`, 3, 15 * 60_000);
    return jsonOk(await requestAccountRecovery({
      ...input, ipAddress: ip, userAgent: request.headers.get("user-agent"),
    }), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
