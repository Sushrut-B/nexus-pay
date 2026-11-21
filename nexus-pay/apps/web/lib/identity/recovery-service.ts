/** Release 20 — safe account recovery with hashed, single-use, short-lived tokens. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { hashPassword } from "@/lib/security/passwords";
import { generateOpaqueToken, hashToken } from "@/lib/security/tokens";
import { notifyIdentity, publishIdentityEvent, recordAdminSecurityAction } from "@/lib/identity/identity-audit";

const GENERIC_MESSAGE =
  "If an account exists for that email address, recovery instructions have been sent.";

export async function requestAccountRecovery(input: {
  email: string; reason?: string; ipAddress?: string | null; userAgent?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });

  if (user) {
    await prisma.accountRecoveryRequest.updateMany({
      where: { userId: user.id, status: "REQUESTED" },
      data: { status: "EXPIRED" },
    });
    const token = generateOpaqueToken();
    const ttl = getServerEnv().NEXUS_SECURITY_RECOVERY_TTL_MINUTES;
    await prisma.accountRecoveryRequest.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttl * 60_000),
        reason: input.reason ?? null,
      },
    });
    await publishIdentityEvent({
      type: "ACCOUNT_RECOVERY_REQUESTED",
      userId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { outcome: "REQUESTED" },
    });
    await notifyIdentity({
      userId: user.id,
      eventKey: `security:recovery-requested:${Date.now()}`,
      type: "SECURITY_ACCOUNT_RECOVERY",
      title: "Account recovery requested",
      body: "A recovery request was made for your account. No account details are included here.",
    });
    // Isolated development adapter: the dev-mode link is only returned when
    // explicitly enabled and is never a production delivery claim.
    const devToken = getServerEnv().PASSWORD_RESET_DEV_MODE ? token : undefined;
    return { message: GENERIC_MESSAGE, ...(devToken ? { devToken } : {}) };
  }
  // Same generic response and timing shape for unknown accounts.
  await hashPassword("timing-equalization-password-value");
  return { message: GENERIC_MESSAGE };
}

export async function completeAccountRecovery(input: {
  token: string; newPassword: string;
}) {
  const request = await prisma.accountRecoveryRequest.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (!request || request.status !== "REQUESTED" || request.usedAt || request.expiresAt <= new Date()) {
    throw new ApiError(400, "VALIDATION_ERROR", "This recovery link is invalid or has expired.");
  }
  const passwordHash = await hashPassword(input.newPassword);
  const user = await prisma.user.findUnique({ where: { id: request.userId }, select: { id: true, accountStatus: true } });
  if (!user || user.accountStatus !== "ACTIVE") {
    throw new ApiError(400, "VALIDATION_ERROR", "This recovery link is invalid or has expired.");
  }
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.accountRecoveryRequest.updateMany({
      where: { id: request.id, status: "REQUESTED", usedAt: null, expiresAt: { gt: new Date() } },
      data: { status: "COMPLETED", usedAt: new Date(), completedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ApiError(400, "VALIDATION_ERROR", "This recovery link is invalid or has expired.");
    }
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() },
    });
  });
  await publishIdentityEvent({ type: "ACCOUNT_RECOVERY_COMPLETED", userId: user.id, metadata: { outcome: "SUCCESS" } });
  await publishIdentityEvent({ type: "PASSWORD_CHANGED", userId: user.id, metadata: { source: "RECOVERY" } });
  await publishIdentityEvent({ type: "SESSION_REVOKED", userId: user.id, metadata: { reason: "ACCOUNT_RECOVERY" } });
  await notifyIdentity({
    userId: user.id,
    eventKey: `security:recovery-completed:${request.id}`,
    type: "SECURITY_ACCOUNT_RECOVERY",
    title: "Account recovery completed",
    body: "Your password was changed and other sessions were signed out.",
  });
  return { redirectTo: "/login?recovered=1" };
}

export async function listRecoveryRequests(userId: string) {
  const rows = await prisma.accountRecoveryRequest.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}

export async function adminReviewRecovery(
  actorId: string, requestId: string, decision: "APPROVED" | "REJECTED", reason: string,
) {
  const request = await prisma.accountRecoveryRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new ApiError(404, "VALIDATION_ERROR", "Recovery request not found");
  if (decision === "REJECTED") {
    await prisma.accountRecoveryRequest.update({
      where: { id: requestId }, data: { status: "REJECTED" },
    });
  }
  await publishIdentityEvent({ type: "ADMIN_RECOVERY_REVIEWED", userId: request.userId, actorId, metadata: { decision } });
  await recordAdminSecurityAction({
    actorId, action: "ADMIN_RECOVERY_REVIEWED", targetType: "ACCOUNT_RECOVERY_REQUEST",
    targetId: requestId, reason, metadata: { decision },
  });
  return { id: requestId, decision };
}
