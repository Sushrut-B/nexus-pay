import { prisma, type User, type UserProfile, type Wallet } from "@nexus/database";
import type { CurrencyCode, RecipientSummary, ReceiveProfile } from "@nexus/shared-types";
import { normalizeEmail, normalizePhoneNumber } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { appBaseUrl } from "@/lib/env";
import { signRecipientToken, verifyRecipientToken } from "@/lib/payments/recipient-token";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export interface ResolvedRecipient {
  user: User;
  profile: UserProfile;
  wallet: Wallet;
  recipientToken: string;
}

/**
 * Resolves a recipient by one exact identifier and returns only the display
 * handle plus a short-lived signed token. Ledger account IDs never leave the
 * server, and there is no prefix or list-based search.
 */
export async function searchRecipient(
  requesterId: string,
  rawQuery: string,
): Promise<RecipientSummary> {
  const trimmed = rawQuery.trim();
  const normalized = trimmed.toLowerCase();

  let where:
    | { username: string }
    | { email: string }
    | { phoneNumber: string };

  if (emailLooksExact(normalized)) {
    where = { email: normalizeEmail(normalized) };
  } else if (phoneLooksExact(trimmed)) {
    where = { phoneNumber: normalizePhoneNumber(trimmed) };
  } else if (USERNAME_PATTERN.test(normalized)) {
    where = { username: normalized };
  } else {
    throw recipientNotFound();
  }

  const user = await prisma.user.findFirst({
    where: {
      ...where,
      accountStatus: "ACTIVE",
      onboardingCompletedAt: { not: null },
    },
    include: {
      profile: true,
      wallets: { where: { currency: "INR" } },
    },
  });

  if (!user || !user.profile) throw recipientNotFound();
  if (user.id === requesterId) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot send money to yourself.");
  }

  const wallet = user.wallets[0];
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "This Nexus Pay account cannot receive INR payments yet.",
    );
  }

  return {
    displayName: user.profile.displayName,
    username: user.username,
    recipientToken: signRecipientToken({
      userId: user.id,
      username: user.username,
      displayName: user.profile.displayName,
    }),
  };
}

export async function resolveRecipientToken(token: string): Promise<ResolvedRecipient> {
  const claims = verifyRecipientToken(token);
  if (!claims) {
    throw new ApiError(
      400,
      "PAYMENT_ERROR",
      "This recipient reference is invalid or has expired. Choose the recipient again.",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    include: {
      profile: true,
      wallets: { where: { currency: "INR" } },
    },
  });

  if (
    !user ||
    !user.profile ||
    user.accountStatus !== "ACTIVE" ||
    user.username !== claims.username
  ) {
    throw new ApiError(
      400,
      "PAYMENT_ERROR",
      "This recipient is no longer available. Choose the recipient again.",
    );
  }

  const wallet = user.wallets[0];
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "This Nexus Pay account cannot receive INR payments yet.",
    );
  }

  return {
    user,
    profile: user.profile,
    wallet,
    recipientToken: token,
  };
}

export async function resolveRecipientByUsername(username: string): Promise<ResolvedRecipient> {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) throw recipientNotFound();

  const user = await prisma.user.findFirst({
    where: {
      username: normalized,
      accountStatus: "ACTIVE",
      onboardingCompletedAt: { not: null },
    },
    include: {
      profile: true,
      wallets: { where: { currency: "INR" } },
    },
  });

  if (!user || !user.profile) throw recipientNotFound();
  const wallet = user.wallets[0];
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "This Nexus Pay account cannot receive INR payments yet.",
    );
  }

  return {
    user,
    profile: user.profile,
    wallet,
    recipientToken: signRecipientToken({
      userId: user.id,
      username: user.username,
      displayName: user.profile.displayName,
    }),
  };
}

export async function getReceiveProfile(userId: string): Promise<ReceiveProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      wallets: { where: { currency: "INR" } },
    },
  });
  if (!user || !user.profile) {
    throw new ApiError(404, "DATABASE_ERROR", "Your profile could not be found.");
  }

  const wallet = user.wallets[0];
  return {
    displayName: user.profile.displayName,
    username: user.username,
    handle: `@${user.username}`,
    paymentLink: `${appBaseUrl().origin}/pay/${user.username}`,
    currency: wallet?.currency ?? user.profile.preferredCurrency,
    walletStatus: wallet?.status ?? "PENDING",
    walletActive: wallet?.status === "ACTIVE" && Boolean(wallet.raftlineAccountId),
    disclosure:
      "This is a Nexus Pay payment link, not a UPI ID or UPI QR code. It only works between Nexus Pay accounts.",
  };
}

export function recipientCurrency(wallet: Wallet): CurrencyCode {
  return wallet.currency as CurrencyCode;
}

function emailLooksExact(value: string): boolean {
  return value.includes("@") && EMAIL_PATTERN.test(value);
}

function phoneLooksExact(value: string): boolean {
  return PHONE_PATTERN.test(normalizePhoneNumber(value));
}

function recipientNotFound(): ApiError {
  return new ApiError(
    404,
    "RECIPIENT_NOT_FOUND",
    "No Nexus Pay account matches that exact username, email address or mobile number.",
  );
}
