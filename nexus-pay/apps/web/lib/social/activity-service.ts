import type { ActivityListResult, ActivityView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { assertMembership } from "@/lib/social/group-service";
import { toSocialParty } from "@/lib/social/shared";
import { prisma } from "@nexus/database";

export async function listGroupActivity(
  userId: string,
  groupId: string,
): Promise<ActivityListResult> {
  await assertMembership(userId, groupId);
  const events = await prisma.groupActivity.findMany({
    where: { groupId },
    include: { actor: { include: { profile: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const items: ActivityView[] = events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    actor: event.actor ? toSocialParty(event.actor) : null,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata as ActivityView["metadata"],
    createdAt: event.createdAt.toISOString(),
  }));

  return { items, total: items.length };
}

export async function assertActivityAccess(userId: string, eventId: string): Promise<void> {
  const event = await prisma.groupActivity.findUnique({ where: { id: eventId } });
  if (!event) throw new ApiError(404, "PAYMENT_ERROR", "That activity event could not be found.");
  await assertMembership(userId, event.groupId);
}
