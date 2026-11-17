import { prisma, Prisma } from "@nexus/database";
import type {
  ActivityEventType,
  NotificationType,
  SocialParty,
} from "@nexus/shared-types";

export type SocialDb = typeof prisma | Prisma.TransactionClient;

export type PartySource = {
  id: string;
  username: string;
  fullName: string;
  profile?: { displayName: string } | null;
};

export function toSocialParty(user: PartySource): SocialParty {
  return {
    userId: user.id,
    displayName: user.profile?.displayName ?? user.fullName,
    username: user.username,
  };
}

export async function loadParty(db: SocialDb, userId: string): Promise<SocialParty> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new Error("A referenced Nexus Pay customer could not be found");
  }
  return toSocialParty(user);
}

type JsonScalar = string | number | boolean | null;

export async function recordActivity(
  db: SocialDb,
  input: {
    groupId: string;
    actorUserId: string | null;
    eventType: ActivityEventType;
    entityType: string;
    entityId: string;
    metadata?: Record<string, JsonScalar>;
  },
): Promise<void> {
  await db.groupActivity.create({
    data: {
      groupId: input.groupId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function createNotification(
  db: SocialDb,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string | null;
    data?: Record<string, JsonScalar>;
  },
): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
  });
}
