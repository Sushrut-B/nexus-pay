import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@nexus/database";
import { resetPasswordSchema } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk, ApiError } from "@/lib/api/response";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword } from "@/lib/security/passwords";
import { hashToken } from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(
      `reset-password:${getClientIp(request)}`,
      10,
      15 * 60 * 1000,
      "Too many reset attempts. Please wait before trying again.",
    );

    const body = await readJsonBody(request);
    const input = resetPasswordSchema.parse(body);
    const tokenHash = hashToken(input.token);

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date() ||
      resetToken.user.accountStatus !== "ACTIVE"
    ) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "This reset link is invalid or has expired. Request a new one.",
      );
    }

    const passwordHash = await hashPassword(input.password);

    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "This reset link is invalid or has expired. Request a new one.",
        );
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.userSession.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);

    await recordAudit({
      actorId: resetToken.userId,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: "user",
      entityId: resetToken.userId,
    });

    return jsonOk({ redirectTo: "/login?reset=success" }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
