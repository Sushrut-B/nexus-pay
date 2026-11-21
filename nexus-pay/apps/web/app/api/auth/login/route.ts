import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { hashDevice, publishSecurityEvent } from "@/lib/fraud/event-service";
import { recordDeviceActivity } from "@/lib/fraud/device-service";
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

    const userAgent = request.headers.get("user-agent");
    const identifierKey = createHash("sha256").update(input.identifier.trim().toLowerCase()).digest("hex").slice(0, 24);
    let result;
    try {
      result = await authenticateCustomer(
        input.identifier,
        input.password,
        Boolean(input.rememberMe),
        { ipAddress: ip, userAgent },
      );
    } catch (error) {
      await publishSecurityEvent({
        eventId: `login_fail_${requestId}`,
        type: "LOGIN_FAILURE",
        occurredAt: new Date(),
        subjectId: identifierKey,
        sourceModule: "auth",
        ipAddress: ip,
        userAgent,
        requestId,
        metadata: { outcome: "FAILURE" },
      });
      throw error;
    }

    if (result.mfa) {
      return jsonOk({
        mfaRequired: true,
        challengeToken: result.mfa.challengeToken,
        expiresAt: result.mfa.expiresAt,
        notice: result.mfa.notice,
      }, requestId);
    }

    const auth = await getAuthenticatedUser();
    const deviceId = request.headers.get("x-device-id") ?? hashDevice(userAgent) ?? "unknown-device";
    const device = await recordDeviceActivity({
      userId: result.user.id,
      deviceId,
      description: userAgent?.slice(0, 180) ?? "Unknown device",
      userAgent,
      ipAddress: ip,
      sessionId: auth?.sessionId,
    });
    await publishSecurityEvent({
      eventId: `login_ok_${requestId}`,
      type: "LOGIN_SUCCESS",
      occurredAt: new Date(),
      actorId: result.user.id,
      sessionId: auth?.sessionId ?? null,
      sourceModule: "auth",
      deviceId,
      ipAddress: ip,
      userAgent,
      requestId,
      metadata: { outcome: "SUCCESS" },
    });
    if (device.isNew) {
      await publishSecurityEvent({
        eventId: `new_device_${requestId}`,
        type: "NEW_DEVICE_LOGIN",
        occurredAt: new Date(),
        actorId: result.user.id,
        sessionId: auth?.sessionId ?? null,
        sourceModule: "auth",
        deviceId,
        ipAddress: ip,
        userAgent,
        requestId,
        metadata: { deviceId },
      });
    }

    return jsonOk(
      { redirectTo: result.onboardingComplete ? "/home" : "/onboarding" },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
