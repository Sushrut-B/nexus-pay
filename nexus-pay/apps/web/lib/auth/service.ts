import { Prisma, prisma, type User, type UserProfile } from "@nexus/database";
import type { OnboardingInput, RegisterInput } from "@nexus/validation";
import { normalizeEmail, normalizeUsername } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import { createSession, type SessionMetadata } from "@/lib/auth/session";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "@/lib/security/passwords";

export async function registerCustomer(
  input: RegisterInput,
  metadata: SessionMetadata,
): Promise<{ user: User; profile: UserProfile }> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const phoneNumber = input.phoneNumber;

  const [emailOwner, usernameOwner, phoneOwner] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.user.findUnique({ where: { phoneNumber }, select: { id: true } }),
  ]);

  const fields: Record<string, string> = {};
  if (emailOwner) fields.email = "An account with this email already exists.";
  if (usernameOwner) fields.username = "That username is already taken.";
  if (phoneOwner) fields.phoneNumber = "An account with this mobile number already exists.";
  if (Object.keys(fields).length > 0) {
    throw new ApiError(409, "VALIDATION_ERROR", "Some account details are already in use.", fields);
  }

  const passwordHash = await hashPassword(input.password);
  const displayName = input.fullName.trim().split(/\s+/)[0] ?? input.fullName.trim();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          email,
          phoneNumber,
          passwordHash,
          username,
          profile: {
            create: {
              displayName,
              preferredCurrency: "INR",
              preferredLanguage: "en-IN",
            },
          },
        },
        include: { profile: true },
      });

      if (!user.profile) {
        throw new Error("User profile was not created");
      }
      return { user, profile: user.profile };
    });

    await createSession(result.user.id, false, metadata);
    await recordAudit({
      actorId: result.user.id,
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: "user",
      entityId: result.user.id,
    });

    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "VALIDATION_ERROR", "Some account details are already in use.");
    }
    throw error;
  }
}

export async function authenticateCustomer(
  identifier: string,
  password: string,
  rememberMe: boolean,
  metadata: SessionMetadata,
): Promise<{ user: User; profile: UserProfile; onboardingComplete: boolean }> {
  const normalised = identifier.trim().toLowerCase();
  const lookup = normalised.includes("@") ? { email: normalised } : { username: normalised };

  const user = await prisma.user.findUnique({
    where: lookup,
    include: { profile: true },
  });

  const passwordValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !user.profile || !passwordValid || user.accountStatus !== "ACTIVE") {
    await recordAudit({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entityType: "user_session",
      entityId: "anonymous",
      metadata: { reason: "invalid_credentials" },
    });
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Email, username or password is incorrect.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await createSession(user.id, rememberMe, metadata);
  await recordAudit({
    actorId: user.id,
    action: AUDIT_ACTIONS.USER_LOGGED_IN,
    entityType: "user_session",
    entityId: user.id,
  });

  return {
    user,
    profile: user.profile,
    onboardingComplete: Boolean(user.onboardingCompletedAt),
  };
}

export async function completeOnboarding(
  userId: string,
  input: OnboardingInput,
): Promise<{ walletId: string; alreadyCompleted: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "Your account could not be found.");
  }

  if (user.onboardingCompletedAt) {
    return { walletId: "", alreadyCompleted: true };
  }

  const username = normalizeUsername(input.username);
  const usernameOwner = await prisma.user.findFirst({
    where: { username, NOT: { id: userId } },
    select: { id: true },
  });
  if (usernameOwner) {
    throw new ApiError(409, "VALIDATION_ERROR", "That username is already taken.", {
      username: "That username is already taken.",
    });
  }

  try {
    const wallet = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          username,
          onboardingCompletedAt: new Date(),
        },
      });
      await tx.userProfile.update({
        where: { userId },
        data: {
          displayName: input.displayName,
          preferredCurrency: input.preferredCurrency,
          preferredLanguage: input.preferredLanguage,
        },
      });
      return tx.wallet.upsert({
        where: {
          userId_currency: {
            userId,
            currency: input.preferredCurrency,
          },
        },
        create: {
          userId,
          currency: input.preferredCurrency,
          status: "PENDING",
        },
        update: {},
      });
    });

    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.ONBOARDING_COMPLETED,
      entityType: "user",
      entityId: userId,
      metadata: { walletId: wallet.id, currency: wallet.currency },
    });

    return { walletId: wallet.id, alreadyCompleted: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "VALIDATION_ERROR", "That username is already taken.", {
        username: "That username is already taken.",
      });
    }
    throw error;
  }
}
