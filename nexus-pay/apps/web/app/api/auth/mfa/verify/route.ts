import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { mfaVerifySchema } from "@nexus/validation";
import { completeMfaLogin, consumeRecoveryCodeForMfa } from "@/lib/identity/mfa-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const ip = getClientIp(request);
    enforceRateLimitOrThrow(`mfa-verify-ip:${ip}`, 10, 5 * 60_000, "Too many verification attempts.");
    const input = mfaVerifySchema.parse(await readJsonBody(request));
    const body = await readJsonBody(request) as { challengeToken?: string; useRecoveryCode?: boolean };
    if (!body.challengeToken) throw new ApiError(400, "VALIDATION_ERROR", "Verification challenge is required.");
    const metadata = { ipAddress: ip, userAgent: request.headers.get("user-agent") };
    // The challenge encodes the user; the service refuses mismatched/expired tokens.
    const challenge = await (await import("@nexus/database")).prisma.mfaChallenge.findUnique({
      where: { tokenHash: (await import("@/lib/security/tokens")).hashToken(body.challengeToken) },
    });
    if (!challenge) throw new ApiError(401, "AUTHENTICATION_ERROR", "The verification challenge is invalid or expired.");
    if (body.useRecoveryCode) {
      await consumeRecoveryCodeForMfa(challenge.userId, body.challengeToken, input.code, false, metadata);
    } else {
      await completeMfaLogin(challenge.userId, body.challengeToken, input.code, false, metadata);
    }
    return jsonOk({ verified: true, redirectTo: "/home" }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
