import { randomBytes } from "node:crypto";
import { prisma } from "@nexus/database";
import type { ApiKeyView } from "@nexus/shared-types";
import type { ApiKeyCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { hashToken } from "@/lib/security/tokens";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

function toView(key: {
  id: string; name: string; keyPrefix: string; scopes: string[]; lastUsedAt: Date | null;
  revokedAt: Date | null; createdAt: Date;
}): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

export async function createApiKey(userId: string, input: ApiKeyCreateInput): Promise<ApiKeyView & { secret: string }> {
  const merchant = await requireMerchantForUser(userId);
  const secret = `npk_${randomBytes(32).toString("base64url")}`;
  const key = await prisma.merchantApiKey.create({
    data: {
      merchantId: merchant.id,
      name: input.name,
      keyPrefix: secret.slice(0, 12),
      keyHash: hashToken(secret),
      scopes: [...input.scopes],
    },
  });
  return { ...toView(key), secret };
}

export async function listApiKeys(userId: string): Promise<ApiKeyView[]> {
  const merchant = await requireMerchantForUser(userId);
  const keys = await prisma.merchantApiKey.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return keys.map(toView);
}

export async function revokeApiKey(userId: string, id: string): Promise<ApiKeyView> {
  const merchant = await requireMerchantForUser(userId);
  const key = await prisma.merchantApiKey.findFirst({ where: { id, merchantId: merchant.id } });
  if (!key) throw new ApiError(404, "AUTHORIZATION_ERROR", "API key not found.");
  const updated = await prisma.merchantApiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return toView(updated);
}

export async function rotateApiKey(userId: string, id: string): Promise<ApiKeyView & { secret: string }> {
  const merchant = await requireMerchantForUser(userId);
  const existing = await prisma.merchantApiKey.findFirst({ where: { id, merchantId: merchant.id } });
  if (!existing) throw new ApiError(404, "AUTHORIZATION_ERROR", "API key not found.");
  const secret = `npk_${randomBytes(32).toString("base64url")}`;
  const updated = await prisma.merchantApiKey.update({
    where: { id },
    data: { keyHash: hashToken(secret), keyPrefix: secret.slice(0, 12) },
  });
  return { ...toView(updated), secret };
}

/** Server-to-server authentication for developer APIs. */
export async function authenticateApiKey(secret: string, scope: string) {
  const key = await prisma.merchantApiKey.findUnique({ where: { keyHash: hashToken(secret) } });
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) return null;
  if (!key.scopes.includes(scope) && !key.scopes.includes("*")) return null;
  await prisma.merchantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key;
}
