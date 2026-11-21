/** Release 20 — authenticated password change with session revocation. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { hashPassword, verifyPassword } from "@/lib/security/passwords";
import { consumeStepUpGrant } from "@/lib/identity/mfa-service";
import { publishIdentityEvent, notifyIdentity, identitySecurityAudit } from "@/lib/identity/identity-audit";

export async function changePassword(input: {
  userId: string;
  sessionId: string;
  currentPassword?: string;
  grantToken?: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}) {
  if (!input.currentPassword && !input.grantToken) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Reauthentication is required.");
  }
  if (input.grantToken) {
    await consumeStepUpGrant(input.userId, input.sessionId, "CHANGE_PASSWORD", input.grantToken);
  } else {
    const user = await prisma.user.findUnique({
      where: { id: input.userId }, select: { passwordHash: true },
    });
    if (!user || !(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
      await publishIdentityEvent({
        type: "STEP_UP_FAILED", userId: input.userId, sessionId: input.sessionId,
        metadata: { action: "CHANGE_PASSWORD" },
      });
      throw new ApiError(403, "AUTHORIZATION_ERROR", "Verification failed.");
    }
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash } });
    if (input.revokeOtherSessions) {
      await tx.userSession.updateMany({
        where: { userId: input.userId, id: { not: input.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  });
  await publishIdentityEvent({ type: "PASSWORD_CHANGED", userId: input.userId, sessionId: input.sessionId, metadata: { source: "SELF_SERVICE" } });
  await publishIdentityEvent({ type: "SESSION_REVOKED", userId: input.userId, sessionId: input.sessionId, metadata: { reason: "PASSWORD_CHANGE" } });
  await notifyIdentity({
    userId: input.userId, eventKey: `security:password-changed:${Date.now()}`,
    type: "SECURITY_ACCOUNT_RECOVERY",
    title: "Your password was changed",
    body: "If you did not make this change, review your account activity.",
  });
  await identitySecurityAudit({
    actorId: input.userId, action: "PASSWORD_CHANGED", targetType: "USER", targetId: input.userId,
  });
  return { changed: true };
}
