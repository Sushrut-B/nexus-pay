import { Prisma, prisma, type User, type UserProfile } from "@nexus/database";
import { cookies } from "next/headers";
import { getServerEnv, isSecureCookie } from "@/lib/env";
import { generateOpaqueToken, hashToken } from "@/lib/security/tokens";

export const SESSION_COOKIE = "np_session";
export const CSRF_COOKIE = "np_csrf";
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuthenticatedUser {
  user: User;
  profile: UserProfile;
  sessionId: string;
}

export async function createSession(
  userId: string,
  rememberMe: boolean,
  metadata: SessionMetadata = {},
): Promise<void> {
  const env = getServerEnv();
  const token = generateOpaqueToken();
  const ttlMs = rememberMe
    ? env.SESSION_REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000
    : env.SESSION_TTL_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.userSession.create({
    data: {
      userId,
      sessionTokenHash: hashToken(token),
      expiresAt,
      ipAddress: metadata.ipAddress?.slice(0, 64) ?? null,
      userAgent: metadata.userAgent?.slice(0, 512) ?? null,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { sessionTokenHash: hashToken(token) },
    include: { user: { include: { profile: true } } },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }
  if (session.user.accountStatus !== "ACTIVE" || !session.user.profile) {
    return null;
  }

  if (
    !session.lastUsedAt ||
    Date.now() - session.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS
  ) {
    await prisma.userSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    user: session.user,
    profile: session.user.profile,
    sessionId: session.id,
  };
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.userSession
      .updateMany({
        where: { sessionTokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch((error: unknown) => {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
