import { createHash } from "node:crypto";
import { Prisma, prisma, type RewardAccount } from "@nexus/database";
import type { NotificationType, RewardActivityType } from "@nexus/shared-types";
import { createNotification } from "@/lib/social/shared";

export type RewardDb = Prisma.TransactionClient | typeof prisma;

/** Deterministic UUID-shaped key so an entitlement always maps to one funding request. */
export function stableUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function getOrCreateRewardAccount(userId: string): Promise<RewardAccount> {
  const existing = await prisma.rewardAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  const defaultTier = await prisma.loyaltyTier.findFirst({ where: { isActive: true }, orderBy: { rank: "asc" } });
  try {
    return await prisma.rewardAccount.create({
      data: { userId, availablePoints: 0, tierId: defaultTier?.id ?? null },
    });
  } catch {
    return prisma.rewardAccount.findUniqueOrThrow({ where: { userId } });
  }
}

export interface RecordActivityInput {
  userId: string;
  type: RewardActivityType;
  description: string;
  points?: number;
  amountMinor?: number;
  currency?: string;
  merchantId?: string;
  merchantName?: string;
  campaignId?: string;
  transactionRef?: string;
  referenceId: string;
  status?: string;
  expiresAt?: Date;
}

/** Idempotent activity record keyed by (type, referenceId). */
export async function recordActivity(db: RewardDb, input: RecordActivityInput): Promise<void> {
  await db.rewardActivity.upsert({
    where: { type_referenceId: { type: input.type, referenceId: input.referenceId } },
    create: {
      userId: input.userId,
      type: input.type,
      description: input.description.slice(0, 300),
      points: input.points ?? null,
      amountMinor: input.amountMinor ?? null,
      currency: input.currency ?? null,
      merchantId: input.merchantId ?? null,
      merchantName: input.merchantName?.slice(0, 120) ?? null,
      campaignId: input.campaignId ?? null,
      transactionRef: input.transactionRef ?? null,
      referenceId: input.referenceId,
      status: input.status ?? "COMPLETED",
      expiresAt: input.expiresAt ?? null,
    },
    update: {},
  });
}

/** Deduplicated notification. The unique event key makes repeats no-ops. */
export async function notifyOnce(
  db: RewardDb,
  input: {
    userId: string;
    type: NotificationType;
    eventKey: string;
    title: string;
    body?: string;
    data?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  const created = await db.rewardNotificationEvent.findUnique({ where: { eventKey: input.eventKey } });
  if (created) return;
  try {
    await db.rewardNotificationEvent.create({
      data: {
        userId: input.userId,
        eventType: input.type,
        eventKey: input.eventKey,
        payload: (input.data ?? {}) as Prisma.InputJsonValue,
        status: "SENT",
      },
    });
  } catch {
    return;
  }
  await createNotification(db, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    data: input.data,
  });
}

export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginationMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
