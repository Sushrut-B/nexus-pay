import { cookies } from "next/headers";
import { prisma, type AdminUser } from "@nexus/database";
import type { AdminRole } from "@nexus/shared-types";
import { getServerEnv, isSecureCookie } from "@/lib/env";
import { generateOpaqueToken, hashToken } from "@/lib/security/tokens";
import { hashPassword, verifyPassword } from "@/lib/security/passwords";
import { recordAdminAudit } from "@/lib/control/audit";

export const ADMIN_SESSION_COOKIE = "np_control_session";
export interface AuthenticatedAdmin {
  admin: AdminUser;
  sessionId: string;
}

/** Environment-only bootstrap. No default credentials are ever shipped. */
export async function ensureBootstrapAdmin(): Promise<void> {
  const env = getServerEnv();
  if (!env.ADMIN_BOOTSTRAP_EMAIL || !env.ADMIN_BOOTSTRAP_USERNAME || !env.ADMIN_BOOTSTRAP_PASSWORD) {
    return;
  }
  const existing = await prisma.adminUser.count();
  if (existing > 0) return;

  await prisma.adminUser.create({
    data: {
      email: env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(),
      username: env.ADMIN_BOOTSTRAP_USERNAME.toLowerCase(),
      passwordHash: await hashPassword(env.ADMIN_BOOTSTRAP_PASSWORD),
      role: "SUPER_ADMIN",
    },
  });
}

export async function authenticateAdmin(
  identifier: string,
  password: string,
  metadata: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {},
): Promise<AuthenticatedAdmin | null> {
  await ensureBootstrapAdmin();
  const normalized = identifier.trim().toLowerCase();
  const admin = await prisma.adminUser.findFirst({
    where: { OR: [{ email: normalized }, { username: normalized }] },
  });

  const valid = await verifyPassword(password, admin?.passwordHash ?? "invalid");
  if (!admin || !admin.isActive || !valid) {
    await recordAdminAudit({
      actorRole: "VIEWER",
      action: "ADMIN_LOGIN_FAILED",
      targetType: "admin_session",
      targetId: "anonymous",
      outcome: "FAILURE",
      ipAddress: metadata.ip ?? null,
      requestId: metadata.requestId ?? null,
      metadata: { identifier: normalized.slice(0, 80) },
    });
    return null;
  }

  const ttlMs = getServerEnv().NEXUS_CONTROL_ADMIN_SESSION_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const token = generateOpaqueToken();
  const session = await prisma.adminSession.create({
    data: {
      adminUserId: admin.id,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: metadata.ip?.slice(0, 64) ?? null,
      userAgent: metadata.userAgent?.slice(0, 512) ?? null,
    },
  });
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.role,
    action: "ADMIN_LOGIN",
    targetType: "admin_session",
    targetId: session.id,
    outcome: "SUCCESS",
    ipAddress: metadata.ip ?? null,
    requestId: metadata.requestId ?? null,
  });

  return { admin, sessionId: session.id };
}

export async function getAuthenticatedAdmin(): Promise<AuthenticatedAdmin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { adminUser: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.adminUser.isActive) {
    return null;
  }
  return { admin: session.adminUser, sessionId: session.id };
}

export async function revokeAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) {
    const session = await prisma.adminSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (session) {
      const admin = await prisma.adminUser.findUnique({ where: { id: session.adminUserId } });
      await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      if (admin) {
        await recordAdminAudit({
          actorId: admin.id,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: "ADMIN_LOGOUT",
          targetType: "admin_session",
          targetId: session.id,
          outcome: "SUCCESS",
        });
      }
    }
  }
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

const PERMISSIONS: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ["*"],
  OPERATOR: [
    "cluster:read", "nodes:read", "leader:read", "metrics:read", "payments:read",
    "reconciliation:read", "reconciliation:write", "chaos:read", "chaos:write",
    "chaos:heal", "alerts:read", "alerts:write", "audit:read", "diagnostics:read",
    "rewards:read", "rewards:write", "finance:read", "finance:write",
  ],
  VIEWER: [
    "cluster:read", "nodes:read", "leader:read", "metrics:read",
    "payments:read", "reconciliation:read", "chaos:read", "alerts:read", "diagnostics:read",
    "rewards:read", "finance:read",
  ],
};

export function hasPermission(role: AdminRole, permission: string): boolean {
  const allowed = PERMISSIONS[role];
  return allowed.includes("*") || allowed.includes(permission);
}
