import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../packages/database/src/index";
import { authenticator } from "otplib";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const passwordHash = await svc.passwords.hashPassword("TestPass!2026");
  return prisma.user.create({
    data: {
      id: `r20_${stamp}_${label}`,
      fullName: `Release Twenty ${label}`,
      email: `r20_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash,
      username: `r20${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Twenty ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  process.env.NEXUS_SECURITY_MFA_ENABLED = "true";
  process.env.NEXUS_SECURITY_ENABLED = "true";
  svc = {
    passwords: await import("../../apps/web/lib/security/passwords"),
    tokens: await import("../../apps/web/lib/security/tokens"),
    crypto: await import("../../apps/web/lib/security/crypto"),
    mfa: await import("../../apps/web/lib/identity/mfa-service"),
    recovery: await import("../../apps/web/lib/identity/recovery-service"),
    privacy: await import("../../apps/web/lib/identity/privacy-service"),
    overview: await import("../../apps/web/lib/identity/security-overview-service"),
    audit: await import("../../apps/web/lib/identity/identity-audit"),
    controlAuth: await import("../../apps/web/lib/control/auth"),
  };
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r20_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 20 account security verification", () => {
  it("ID-01: enrollment activates only with a valid code; secrets encrypted, codes hashed", async () => {
    const user = await createUser("mfa");
    const enrollment = await svc.mfa.beginTotpEnrollment(user.id, "session-local");
    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/i);
    const method = await prisma.authMethod.findUniqueOrThrow({ where: { id: enrollment.enrollmentId } });
    expect(method.encryptedSecret).not.toContain(enrollment.secret);
    await expectApiError(
      svc.mfa.confirmTotpEnrollment(user.id, "session-local", enrollment.enrollmentId, "000000"), 400,
    );
    const secret = svc.crypto.decryptSecret(method.encryptedSecret!);
    const result = await svc.mfa.confirmTotpEnrollment(
      user.id, "session-local", enrollment.enrollmentId, authenticator.generate(secret),
    );
    expect(result.codes).toHaveLength(10);
    const stored = await prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(10);
    expect(stored[0].codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.some((row) => result.codes.includes(row.codeHash))).toBe(false);
    expect(await svc.mfa.hasActiveTotp(user.id)).toBe(true);
  }, 120_000);

  it("ID-02: step-up grants are single-use and bound to the session and action", async () => {
    const user = await createUser("stepup");
    const grant = await svc.mfa.issueStepUpGrant(user.id, "session-local", "MFA_DISABLE");
    await svc.mfa.consumeStepUpGrant(user.id, "session-local", "MFA_DISABLE", grant.grantToken);
    await expectApiError(
      svc.mfa.consumeStepUpGrant(user.id, "session-local", "MFA_DISABLE", grant.grantToken), 403,
    );
    await expectApiError(
      svc.mfa.consumeStepUpGrant(user.id, "other-session", "MFA_DISABLE", grant.grantToken), 403,
    );
  }, 120_000);

  it("ID-03: MFA challenges store only hashes", async () => {
    const user = await createUser("challenge");
    const challenge = await svc.mfa.issueMfaChallenge(user.id);
    const row = await prisma.mfaChallenge.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.tokenHash).not.toContain(challenge.challengeToken);
  }, 120_000);

  it("ID-04: recovery is generic, token single-use and sessions revoked", async () => {
    const user = await createUser("recovery");
    const response = await svc.recovery.requestAccountRecovery({ email: user.email });
    expect(response.message).toContain("If an account exists");
    const session = await prisma.userSession.create({
      data: {
        userId: user.id, sessionTokenHash: svc.tokens.hashToken(`r20-session-${stamp}`),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const token = `r20-recovery-${stamp}`;
    await prisma.accountRecoveryRequest.create({
      data: {
        userId: user.id, tokenHash: svc.tokens.hashToken(token),
        expiresAt: new Date(Date.now() + 60_000), status: "REQUESTED",
      },
    });
    await expectApiError(svc.recovery.completeAccountRecovery({
      token: "invalid-token-value-0001", newPassword: "NewPass!2026", confirmPassword: "NewPass!2026",
    }), 400);
    const result = await svc.recovery.completeAccountRecovery({
      token, newPassword: "NewPass!2026", confirmPassword: "NewPass!2026",
    });
    expect(result.redirectTo).toContain("/login");
    await expectApiError(svc.recovery.completeAccountRecovery({
      token, newPassword: "NewPass!2026", confirmPassword: "NewPass!2026",
    }), 400);
    const revoked = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(revoked.revokedAt).not.toBeNull();
  }, 120_000);

  it("ID-05: consent changes are versioned and recorded; required purposes cannot be withdrawn", async () => {
    const user = await createUser("consent");
    await svc.privacy.ensureDefaultConsents(user.id);
    const consents = await svc.privacy.listConsents(user.id);
    expect(consents.find((c: any) => c.purpose === "ACCOUNT_OPERATION")?.status).toBe("GRANTED");
    await svc.privacy.updateConsent(user.id, { purpose: "PRODUCT_ANALYTICS", version: "1.0", granted: true });
    await svc.privacy.updateConsent(user.id, { purpose: "PRODUCT_ANALYTICS", version: "1.0", granted: false });
    await expectApiError(svc.privacy.updateConsent(user.id, {
      purpose: "ACCOUNT_OPERATION", version: "1.0", granted: false,
    }), 409);
    const events = await prisma.privacyConsentEvent.findMany({ where: { userId: user.id } });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["CONSENT_WITHDRAWN"]));
  }, 120_000);

  it("ID-06: exports are owned, encrypted and delivered through signed links", async () => {
    const owner = await createUser("export-owner");
    const other = await createUser("export-other");
    const request = await svc.privacy.requestDataExport(owner.id, {
      format: "JSON", idempotencyKey: `r20-export-${stamp}`,
    });
    const retry = await svc.privacy.requestDataExport(owner.id, {
      format: "JSON", idempotencyKey: `r20-export-${stamp}`,
    });
    expect(request.id).toBe(retry.id);
    await svc.privacy.generateExport(request.id);
    const row = await prisma.dataExportRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe("READY");
    const raw = await fs.readFile(row.storagePath!, "utf8");
    expect(raw).not.toContain(owner.email);
    await expectApiError(svc.privacy.getExportLink(other.id, request.id), 404);
    const link = await svc.privacy.getExportLink(owner.id, request.id);
    expect(link).toContain("token=");
  }, 120_000);

  it("ID-07: deletion requests are owned and admin review is audited", async () => {
    const owner = await createUser("delete-owner");
    const other = await createUser("delete-other");
    const request = await svc.privacy.requestDataDeletion(owner.id, {
      reason: "No longer using this account", confirmation: "DELETE_MY_ACCOUNT_DATA",
      idempotencyKey: `r20-delete-${stamp}`,
    });
    expect(request.status).toBe("REQUESTED");
    expect((await svc.privacy.listDeletions(other.id)).some((r: any) => r.id === request.id)).toBe(false);
    await svc.privacy.adminReviewDeletion("admin-reviewer", request.id, "REJECTED", "Insufficient verification.");
    const action = await prisma.adminSecurityAction.findFirst({ where: { action: "DATA_DELETION_REVIEWED" } });
    expect(action?.reason).toBe("Insufficient verification.");
    expect(action?.outcome).toBe("SUCCESS");
  }, 120_000);

  it("ID-08: admin session revocation requires the right permission and writes audit", async () => {
    const user = await createUser("revoked");
    const session = await prisma.userSession.create({
      data: {
        userId: user.id, sessionTokenHash: svc.tokens.hashToken(`r20-revoke-${stamp}`),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect(svc.controlAuth.hasPermission("SECURITY_ANALYST", "security:sessions")).toBe(false);
    expect(svc.controlAuth.hasPermission("SECURITY_ADMIN", "security:sessions")).toBe(true);
    await svc.overview.adminRevokeSession("admin-security", session.id, "Suspicious activity review");
    const revoked = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(revoked.revokedAt).not.toBeNull();
    const action = await prisma.adminSecurityAction.findFirst({ where: { action: "ADMIN_SESSION_REVOKED" } });
    expect(action?.reason).toBe("Suspicious activity review");
  }, 120_000);

  it("ID-09: security notifications are de-duplicated by event key", async () => {
    const user = await createUser("notify");
    const first = await svc.audit.notifyIdentity({
      userId: user.id, eventKey: `r20-notify-${stamp}`, type: "SECURITY_PRIVACY_UPDATED",
      title: "Privacy preference updated",
    });
    const second = await svc.audit.notifyIdentity({
      userId: user.id, eventKey: `r20-notify-${stamp}`, type: "SECURITY_PRIVACY_UPDATED",
      title: "Privacy preference updated",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await prisma.notification.count({
      where: { userId: user.id, type: "SECURITY_PRIVACY_UPDATED" },
    })).toBe(1);
  }, 120_000);
});
