/**
 * Release 20 — TOTP MFA, recovery codes and step-up grants.
 * RFC 6238 TOTP via otplib; secrets encrypted at rest, everything else hashed.
 * Passkeys/WebAuthn are intentionally unavailable (no verifier dependency).
 */
import { authenticator } from "otplib";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { createSession, type SessionMetadata } from "@/lib/auth/session";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { generateOpaqueToken, hashToken } from "@/lib/security/tokens";
import type { AuthMethodView, MfaChallengeResult, StepUpResult } from "@nexus/shared-types";
import {
  publishIdentityEvent, identitySecurityAudit, notifyIdentity,
} from "@/lib/identity/identity-audit";

authenticator.options = { window: 1, digits: 6, step: 30 };

const MFA_NOTICE =
  "TOTP authentication uses an authenticator app. Recovery codes are shown once and stored only as hashes. Passkeys/WebAuthn are not available in this release.";

function recoveryCode(): string {
  return generateOpaqueToken().replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase();
}

export async function listAuthMethods(userId: string): Promise<AuthMethodView[]> {
  const methods = await prisma.authMethod.findMany({
    where: { userId }, orderBy: { createdAt: "asc" },
  });
  const views: AuthMethodView[] = [{
    id: "password", type: "PASSWORD", status: "ACTIVE", label: "Password",
    createdAt: "", verifiedAt: null, lastUsedAt: null, available: true,
    notice: "Password is required for all accounts.",
  }];
  for (const method of methods) {
    views.push({
      id: method.id,
      type: method.type as AuthMethodView["type"],
      status: method.status as AuthMethodView["status"],
      label: method.label,
      createdAt: method.createdAt.toISOString(),
      verifiedAt: method.verifiedAt?.toISOString() ?? null,
      lastUsedAt: method.lastUsedAt?.toISOString() ?? null,
      available: method.status === "ACTIVE",
      notice: MFA_NOTICE,
    });
  }
  if (!methods.some((method) => method.type === "PASSKEY")) {
    views.push({
      id: "passkey-unavailable", type: "PASSKEY", status: "REVOKED", label: "Passkeys (WebAuthn)",
      createdAt: "", verifiedAt: null, lastUsedAt: null, available: false,
      notice: "Unavailable: no WebAuthn verifier dependency is configured in this release.",
    });
  }
  return views;
}

export async function hasActiveTotp(userId: string): Promise<boolean> {
  return (await prisma.authMethod.count({
    where: { userId, type: "TOTP", status: "ACTIVE" },
  })) > 0;
}

/** Requires a valid step-up grant (enforced by the route before calling). */
export async function beginTotpEnrollment(userId: string, sessionId: string) {
  if (!(await getServerEnv()).NEXUS_SECURITY_MFA_ENABLED) {
    throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Multi-factor authentication is not enabled in this environment.");
  }
  if (await hasActiveTotp(userId)) {
    throw new ApiError(409, "VALIDATION_ERROR", "An authenticator method is already active. Disable it before enrolling another.");
  }
  await prisma.authMethod.updateMany({
    where: { userId, type: "TOTP", status: "PENDING_VERIFICATION" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  const secret = authenticator.generateSecret();
  const method = await prisma.authMethod.create({
    data: {
      userId, type: "TOTP", status: "PENDING_VERIFICATION",
      encryptedSecret: encryptSecret(secret), label: "Authenticator app",
    },
  });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const provisioningUri = authenticator.keyuri(user?.email ?? userId, "Nexus Pay", secret);
  await publishIdentityEvent({ type: "MFA_ENROLLMENT_STARTED", userId, sessionId, metadata: { methodId: method.id } });
  await identitySecurityAudit({ actorId: userId, action: "MFA_ENROLLMENT_STARTED", targetType: "AUTH_METHOD", targetId: method.id });
  // The secret is returned exactly once and never logged or persisted in plaintext.
  return { enrollmentId: method.id, secret, provisioningUri, notice: MFA_NOTICE };
}

export async function confirmTotpEnrollment(userId: string, sessionId: string, enrollmentId: string, code: string) {
  const method = await prisma.authMethod.findFirst({
    where: { id: enrollmentId, userId, type: "TOTP", status: "PENDING_VERIFICATION" },
  });
  if (!method?.encryptedSecret) throw new ApiError(404, "VALIDATION_ERROR", "Enrollment not found");
  if (!authenticator.check(code, decryptSecret(method.encryptedSecret))) {
    await publishIdentityEvent({ type: "MFA_FAILED", userId, sessionId, metadata: { phase: "enrollment" } });
    throw new ApiError(400, "VALIDATION_ERROR", "That code could not be verified. Try again.");
  }
  const codes = Array.from({ length: 10 }, () => recoveryCode());
  await prisma.$transaction(async (tx) => {
    await tx.authMethod.update({
      where: { id: method.id },
      data: { status: "ACTIVE", verifiedAt: new Date() },
    });
    await tx.recoveryCode.deleteMany({ where: { userId, usedAt: null } });
    await tx.recoveryCode.createMany({
      data: codes.map((value) => ({
        userId, authMethodId: method.id,
        codeHash: hashToken(value), hint: `****${value.slice(-4)}`,
      })),
    });
  });
  await publishIdentityEvent({ type: "MFA_ENABLED", userId, sessionId, metadata: { methodId: method.id } });
  await notifyIdentity({
    userId, eventKey: `security:mfa-enabled:${method.id}`, type: "SECURITY_MFA_ENABLED",
    title: "Authenticator app enabled", body: "Multi-factor authentication was enabled on your account.",
  });
  await identitySecurityAudit({ actorId: userId, action: "MFA_ENABLED", targetType: "AUTH_METHOD", targetId: method.id });
  return { codes, notice: "Store these recovery codes securely. They are shown once." };
}

export async function regenerateRecoveryCodes(userId: string, sessionId: string) {
  if (!(await hasActiveTotp(userId))) throw new ApiError(409, "VALIDATION_ERROR", "Enable an authenticator app first");
  const codes = Array.from({ length: 10 }, () => recoveryCode());
  await prisma.$transaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId, usedAt: null } });
    await tx.recoveryCode.createMany({
      data: codes.map((value) => ({ userId, codeHash: hashToken(value), hint: `****${value.slice(-4)}` })),
    });
  });
  await publishIdentityEvent({ type: "RECOVERY_CODES_REGENERATED", userId, sessionId });
  await identitySecurityAudit({ actorId: userId, action: "RECOVERY_CODES_REGENERATED", targetType: "RECOVERY_CODE", targetId: userId });
  return { codes, notice: "Previous unused codes were invalidated. Store these codes securely." };
}

export async function disableMfa(userId: string, sessionId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.authMethod.updateMany({
      where: { userId, type: "TOTP", status: { in: ["ACTIVE", "PENDING_VERIFICATION"] } },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await tx.recoveryCode.deleteMany({ where: { userId, usedAt: null } });
  });
  await publishIdentityEvent({ type: "MFA_DISABLED", userId, sessionId });
  await notifyIdentity({
    userId, eventKey: `security:mfa-disabled:${Date.now()}`, type: "SECURITY_MFA_DISABLED",
    title: "Authenticator app removed", body: "Multi-factor authentication was disabled on your account.",
  });
  await identitySecurityAudit({ actorId: userId, action: "MFA_DISABLED", targetType: "AUTH_METHOD", targetId: userId });
}

/** First-factor success: challenge instead of a session when MFA is active. */
export async function issueMfaChallenge(userId: string): Promise<MfaChallengeResult> {
  const token = generateOpaqueToken();
  const ttl = getServerEnv().NEXUS_SECURITY_MFA_CHALLENGE_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  await prisma.mfaChallenge.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return {
    mfaRequired: true,
    challengeToken: token,
    expiresAt: expiresAt.toISOString(),
    notice: "Enter the 6-digit code from your authenticator app.",
  };
}

export async function completeMfaLogin(
  userId: string,
  challengeToken: string,
  code: string,
  rememberMe: boolean,
  metadata: SessionMetadata,
): Promise<void> {
  const challenge = await prisma.mfaChallenge.findUnique({ where: { tokenHash: hashToken(challengeToken) } });
  if (!challenge || challenge.userId !== userId || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "The verification challenge is invalid or expired.");
  }
  const method = await prisma.authMethod.findFirst({
    where: { userId, type: "TOTP", status: "ACTIVE" },
  });
  if (!method?.encryptedSecret) throw new ApiError(401, "AUTHENTICATION_ERROR", "No active authentication method.");
  if (!authenticator.check(code, decryptSecret(method.encryptedSecret))) {
    await publishIdentityEvent({ type: "MFA_FAILED", userId, metadata: { phase: "login" } });
    throw new ApiError(401, "AUTHENTICATION_ERROR", "That code could not be verified.");
  }
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.mfaChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new ApiError(401, "AUTHENTICATION_ERROR", "The verification challenge is invalid or expired.");
    await tx.authMethod.update({ where: { id: method.id }, data: { lastUsedAt: new Date() } });
  });
  await createSession(userId, rememberMe, metadata);
}

/** Used inside the recovery-code MFA path. */
export async function consumeRecoveryCodeForMfa(
  userId: string,
  challengeToken: string,
  code: string,
  rememberMe: boolean,
  metadata: SessionMetadata,
): Promise<void> {
  const challenge = await prisma.mfaChallenge.findUnique({ where: { tokenHash: hashToken(challengeToken) } });
  if (!challenge || challenge.userId !== userId || challenge.consumedAt || challenge.expiresAt <= new Date()) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "The verification challenge is invalid or expired.");
  }
  const recovery = await prisma.recoveryCode.findUnique({ where: { codeHash: hashToken(code) } });
  if (!recovery || recovery.userId !== userId || recovery.usedAt) {
    await publishIdentityEvent({ type: "MFA_FAILED", userId, metadata: { phase: "recovery-code" } });
    throw new ApiError(401, "AUTHENTICATION_ERROR", "That recovery code is invalid or already used.");
  }
  await prisma.$transaction(async (tx) => {
    const used = await tx.recoveryCode.updateMany({
      where: { id: recovery.id, usedAt: null }, data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw new ApiError(401, "AUTHENTICATION_ERROR", "That recovery code is invalid or already used.");
    await tx.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  });
  await publishIdentityEvent({ type: "RECOVERY_CODE_USED", userId, metadata: { method: "MFA" } });
  await notifyIdentity({
    userId, eventKey: `security:recovery-used:${recovery.id}`, type: "SECURITY_RECOVERY_CODE_USED",
    title: "A recovery code was used", body: "A recovery code was used to access your account.",
  });
  await createSession(userId, rememberMe, metadata);
}

/** Persisted, short-lived, single-use step-up grant. */
export async function issueStepUpGrant(userId: string, sessionId: string, action: string): Promise<StepUpResult> {
  const token = generateOpaqueToken();
  const ttl = getServerEnv().NEXUS_SECURITY_STEP_UP_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  await prisma.stepUpGrant.create({
    data: { userId, sessionId, action, tokenHash: hashToken(token), expiresAt },
  });
  return {
    grantToken: token,
    expiresAt: expiresAt.toISOString(),
    action,
    notice: "This verification applies only to the requested action and expires shortly.",
  };
}

export async function consumeStepUpGrant(userId: string, sessionId: string, action: string, token: string) {
  const grant = await prisma.stepUpGrant.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!grant || grant.userId !== userId || grant.sessionId !== sessionId || grant.action !== action ||
      grant.consumedAt || grant.expiresAt <= new Date()) {
    await publishIdentityEvent({ type: "STEP_UP_FAILED", userId, sessionId, metadata: { action } });
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Verification is required for this action.");
  }
  await prisma.stepUpGrant.update({ where: { id: grant.id }, data: { consumedAt: new Date() } });
  await publishIdentityEvent({ type: "STEP_UP_VERIFIED", userId, sessionId, metadata: { action } });
}
