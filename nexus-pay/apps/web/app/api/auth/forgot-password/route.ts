import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { forgotPasswordSchema } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { appBaseUrl, getServerEnv } from "@/lib/env";
import { sendPasswordResetEmail } from "@/lib/email";
import { generateOpaqueToken, hashToken } from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "If an account exists for that email address, a password reset link has been sent.";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(
      `forgot-password:${getClientIp(request)}`,
      5,
      15 * 60 * 1000,
      "Too many reset requests. Please wait before trying again.",
    );

    const body = await readJsonBody(request);
    const input = forgotPasswordSchema.parse(body);
    const env = getServerEnv();

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });

    let devResetUrl: string | null = null;

    if (user) {
      const token = generateOpaqueToken();
      const expiresAt = new Date(
        Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000,
      );

      await prisma.$transaction([
        prisma.passwordResetToken.deleteMany({
          where: { userId: user.id, usedAt: null },
        }),
        prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt,
          },
        }),
      ]);

      const resetUrl = new URL("/reset-password", appBaseUrl());
      resetUrl.searchParams.set("token", token);

      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.profile?.displayName ?? user.fullName,
        resetUrl: resetUrl.toString(),
        expiresInMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      }).catch(() => undefined);

      if (env.PASSWORD_RESET_DEV_MODE) {
        devResetUrl = resetUrl.toString();
      }

      await recordAudit({
        actorId: user.id,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        entityType: "user",
        entityId: user.id,
      });
    }

    return jsonOk(
      {
        message: GENERIC_MESSAGE,
        ...(devResetUrl ? { devResetUrl } : {}),
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
