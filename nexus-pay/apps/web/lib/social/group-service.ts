import { prisma, type GroupMember } from "@nexus/database";
import type {
  GroupCategory,
  GroupDetail,
  GroupListResult,
  GroupMemberView,
  GroupRole,
  GroupView,
} from "@nexus/shared-types";
import type { GroupCreateInput, GroupMemberInput, GroupUpdateInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { getMemberBalanceMinor } from "@/lib/social/group-balance-service";
import { createNotification, loadParty, recordActivity, toSocialParty } from "@/lib/social/shared";

type GroupWithContext = Awaited<ReturnType<typeof loadGroup>>;

async function loadGroup(groupId: string) {
  const group = await prisma.expenseGroup.findUnique({
    where: { id: groupId },
    include: {
      members: { include: { user: { include: { profile: true } } }, orderBy: { joinedAt: "asc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { members: true, expenses: true } },
    },
  });
  if (!group) {
    throw new ApiError(404, "PAYMENT_ERROR", "That group could not be found.");
  }
  return group;
}

export async function assertMembership(
  userId: string,
  groupId: string,
  adminOnly = false,
): Promise<GroupMember> {
  const membership = await prisma.groupMember.findFirst({
    where: { groupId, userId, removedAt: null },
  });
  if (!membership) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "You are not a member of this group.");
  }
  if (adminOnly && membership.role !== "ADMIN") {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Only a group administrator can do that.");
  }
  return membership;
}

async function toGroupView(group: GroupWithContext, viewerId: string): Promise<GroupView> {
  const membership = group.members.find((member) => member.userId === viewerId && !member.removedAt);
  const myBalanceMinor = membership
    ? await getMemberBalanceMinor(group.id, viewerId).catch(() => 0)
    : 0;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    category: group.category,
    imageUrl: group.imageUrl,
    createdBy: group.createdBy,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    archivedAt: group.archivedAt?.toISOString() ?? null,
    memberCount: group.members.filter((member) => !member.removedAt).length,
    role: membership?.role ?? "MEMBER",
    myBalanceMinor,
    lastActivityAt: group.activities[0]?.createdAt.toISOString() ?? null,
  };
}

function toMemberView(member: GroupWithContext["members"][number]): GroupMemberView {
  return {
    ...toSocialParty(member.user),
    membershipId: member.id,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    removedAt: member.removedAt?.toISOString() ?? null,
  };
}

async function resolveMemberCandidate(requesterId: string, query: string) {
  try {
    const summary = await searchRecipient(requesterId, query);
    const user = await prisma.user.findUnique({ where: { username: summary.username } });
    if (!user) throw new Error("missing user");
    return user;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.category === "PAYMENT_ERROR" &&
      error.message.includes("yourself")
    ) {
      return null;
    }
    if (error instanceof ApiError && error.category === "RECIPIENT_NOT_FOUND") {
      throw new ApiError(
        404,
        "RECIPIENT_NOT_FOUND",
        "No Nexus Pay customer matches that search. Check the exact handle, email or mobile number.",
      );
    }
    throw error;
  }
}

export async function createGroup(userId: string, input: GroupCreateInput): Promise<GroupView> {
  const candidates: string[] = [];
  for (const query of input.memberQueries) {
    const user = await resolveMemberCandidate(userId, query);
    if (user) candidates.push(user.id);
  }

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.expenseGroup.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        category: input.category as GroupCategory,
        imageUrl: input.imageUrl ?? null,
        createdBy: userId,
        members: {
          create: [
            { userId, role: "ADMIN" as GroupRole },
            ...candidates
              .filter((id) => id !== userId)
              .map((id) => ({ userId: id, role: "MEMBER" as GroupRole })),
          ],
        },
      },
      include: {
        members: { include: { user: { include: { profile: true } } }, orderBy: { joinedAt: "asc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { members: true, expenses: true } },
      },
    });

    const me = await loadParty(tx, userId);
    await recordActivity(tx, {
      groupId: created.id,
      actorUserId: userId,
      eventType: "GROUP_CREATED",
      entityType: "group",
      entityId: created.id,
      metadata: { name: created.name },
    });
    for (const candidateId of candidates.filter((id) => id !== userId)) {
      await recordActivity(tx, {
        groupId: created.id,
        actorUserId: userId,
        eventType: "MEMBER_JOINED",
        entityType: "user",
        entityId: candidateId,
      });
      await createNotification(tx, {
        userId: candidateId,
        type: "ADDED_TO_GROUP",
        title: `You were added to ${created.name}`,
        body: `${me.displayName} added you to a Nexus Pay group.`,
        data: { groupId: created.id },
      });
    }
    return created;
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.USER_REGISTERED,
    entityType: "expense_group",
    entityId: group.id,
    metadata: { name: group.name },
  });

  return toGroupView(group, userId);
}

export async function listGroups(userId: string): Promise<GroupListResult> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, removedAt: null },
    orderBy: { joinedAt: "desc" },
  });
  const groups = await Promise.all(
    memberships.map(async (membership) => {
      const group = await loadGroup(membership.groupId);
      return toGroupView(group, userId);
    }),
  );
  return { items: groups, total: groups.length };
}

export async function getGroupDetail(userId: string, groupId: string): Promise<GroupDetail> {
  await assertMembership(userId, groupId);
  const group = await loadGroup(groupId);
  return {
    ...(await toGroupView(group, userId)),
    members: group.members.map(toMemberView),
  };
}

export async function updateGroup(
  userId: string,
  groupId: string,
  input: GroupUpdateInput,
): Promise<GroupView> {
  await assertMembership(userId, groupId, true);
  const group = await prisma.$transaction(async (tx) => {
    const updated = await tx.expenseGroup.update({
      where: { id: groupId },
      data: {
        name: input.name,
        description: input.description === null ? null : input.description,
        category: input.category,
        imageUrl: input.imageUrl === null ? null : input.imageUrl,
        archivedAt: input.archived ? new Date() : input.archived === false ? null : undefined,
      },
      include: {
        members: { include: { user: { include: { profile: true } } }, orderBy: { joinedAt: "asc" } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { members: true, expenses: true } },
      },
    });
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "GROUP_UPDATED",
      entityType: "group",
      entityId: groupId,
    });
    return updated;
  });
  return toGroupView(group, userId);
}

export async function addGroupMember(
  userId: string,
  groupId: string,
  input: GroupMemberInput,
): Promise<GroupMemberView> {
  await assertMembership(userId, groupId, true);
  const user = await resolveMemberCandidate(userId, input.query);
  if (!user) {
    throw new ApiError(400, "PAYMENT_ERROR", "You are already a member of this group.");
  }

  const member = await prisma.$transaction(async (tx) => {
    const existing = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });
    const saved = existing
      ? await tx.groupMember.update({
          where: { id: existing.id },
          data: { removedAt: null, role: "MEMBER", joinedAt: new Date() },
          include: { user: { include: { profile: true } } },
        })
      : await tx.groupMember.create({
          data: { groupId, userId: user.id, role: "MEMBER" },
          include: { user: { include: { profile: true } } },
        });
    const group = await tx.expenseGroup.findUniqueOrThrow({ where: { id: groupId } });
    const me = await loadParty(tx, userId);
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "MEMBER_JOINED",
      entityType: "user",
      entityId: user.id,
    });
    await createNotification(tx, {
      userId: user.id,
      type: "ADDED_TO_GROUP",
      title: `You were added to ${group.name}`,
      body: `${me.displayName} added you to a Nexus Pay group.`,
      data: { groupId },
    });
    return saved;
  });
  return toMemberView(member);
}

export async function removeGroupMember(
  userId: string,
  groupId: string,
  targetUserId: string,
): Promise<void> {
  await assertMembership(userId, groupId, true);
  const membership = await prisma.groupMember.findFirst({
    where: { groupId, userId: targetUserId, removedAt: null },
  });
  if (!membership) {
    throw new ApiError(404, "PAYMENT_ERROR", "That member is not in this group.");
  }
  if (targetUserId === userId || membership.role === "ADMIN") {
    throw new ApiError(409, "PAYMENT_ERROR", "The group administrator cannot be removed.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.groupMember.update({ where: { id: membership.id }, data: { removedAt: new Date() } });
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "MEMBER_REMOVED",
      entityType: "user",
      entityId: targetUserId,
    });
  });
}
