import { createHmac } from "node:crypto";
import { prisma, type SavedBillerAccount } from "@nexus/database";
import type { SavedBillAccountView } from "@nexus/shared-types";
import type { SavedBillAccountInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { getBiller } from "@/lib/billing/catalog-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

function mask(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-4)}`;
}

export function accountView(row: SavedBillerAccount & { biller: { name: string; category: { code: string } } }): SavedBillAccountView {
  return {
    id: row.id, billerId: row.billerId, billerName: row.biller.name,
    category: row.biller.category.code as SavedBillAccountView["category"],
    nickname: row.nickname, maskedIdentifier: row.maskedIdentifier,
    lastFetchAt: row.lastFetchAt?.toISOString() ?? null,
    lastPaymentAt: row.lastPaymentAt?.toISOString() ?? null,
    status: row.status,
  };
}

export async function listAccounts(userId: string) {
  const rows = await prisma.savedBillerAccount.findMany({
    where: { userId, status: "ACTIVE" },
    include: { biller: { include: { category: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => accountView(row as never));
}

async function ownedAccount(userId: string, id: string) {
  const row = await prisma.savedBillerAccount.findFirst({
    where: { id, userId, status: "ACTIVE" },
    include: { biller: { include: { category: true } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Saved biller account not found.");
  return row;
}

export async function getAccount(userId: string, id: string) {
  return accountView(await ownedAccount(userId, id) as never);
}

/** Returns decrypted parameters for server-side provider calls only. Never sent to browsers. */
export async function getAccountParameters(userId: string, id: string): Promise<Record<string, string>> {
  const row = await ownedAccount(userId, id);
  const stored = row.parameters as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    out[key] = typeof value === "string" && value.startsWith("enc:") ? decryptSecret(value.slice(4)) : value;
  }
  return out;
}

export async function createAccount(userId: string, input: SavedBillAccountInput) {
  await getBiller(input.billerId);
  const sensitiveKeys = new Set(
    (await prisma.billerParameter.findMany({ where: { billerId: input.billerId, sensitive: true } })).map((p) => p.name),
  );
  const stored: Record<string, string> = {};
  let identifier = "";
  for (const [key, value] of Object.entries(input.parameters)) {
    const text = String(value).trim().slice(0, 300);
    stored[key] = sensitiveKeys.has(key) ? `enc:${encryptSecret(text)}` : text;
    if (!identifier && !["name", "nickname"].includes(key)) identifier = text;
  }
  const row = await prisma.savedBillerAccount.create({
    data: {
      userId, billerId: input.billerId, nickname: input.nickname,
      parameters: stored as object, maskedIdentifier: mask(identifier || "ACCOUNT"),
    },
  });
  await publishSecurityEvent({
    eventId: `biller_account_${row.id}`, type: "BILLER_ACCOUNT_ADDED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "billing",
    metadata: { billerId: input.billerId, maskedIdentifier: row.maskedIdentifier },
  });
  return getAccount(userId, row.id);
}

export async function updateAccount(userId: string, id: string, input: SavedBillAccountInput) {
  await ownedAccount(userId, id);
  const sensitiveKeys = new Set(
    (await prisma.billerParameter.findMany({ where: { billerId: input.billerId, sensitive: true } })).map((p) => p.name),
  );
  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.parameters)) {
    const text = String(value).trim().slice(0, 300);
    stored[key] = sensitiveKeys.has(key) ? `enc:${encryptSecret(text)}` : text;
  }
  await prisma.savedBillerAccount.update({
    where: { id }, data: { billerId: input.billerId, nickname: input.nickname, parameters: stored as object },
  });
  return getAccount(userId, id);
}

export async function deleteAccount(userId: string, id: string) {
  await ownedAccount(userId, id);
  await prisma.savedBillerAccount.update({ where: { id }, data: { status: "DELETED" } });
  return { id, deleted: true };
}

export function signedAccountReference(accountId: string, expiresAt: number) {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${accountId}:${expiresAt}`).digest("hex");
}
