import { prisma, type HouseholdRole } from "@nexus/database";
import type { HouseholdBillInput, HouseholdInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { securityAudit } from "@/lib/fraud/audit-service";

const RANK: Record<HouseholdRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export async function createHousehold(userId: string, input: HouseholdInput) {
  const row = await prisma.household.create({
    data: {
      name: input.name, ownerId: userId,
      members: { create: { userId, role: "OWNER", joinedAt: new Date() } },
    },
  });
  await securityAudit({ actorType: "USER", actorId: userId, action: "HOUSEHOLD_CREATED", targetType: "household", targetId: row.id });
  return row;
}

export async function listHouseholds(userId: string) {
  return prisma.household.findMany({
    where: { members: { some: { userId, status: "ACTIVE" } } },
    include: { members: true, _count: { select: { bills: true } } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
}

export async function getHousehold(userId: string, id: string) {
  const row = await prisma.household.findFirst({
    where: { id, members: { some: { userId, status: "ACTIVE" } } },
    include: { members: true, bills: { orderBy: { createdAt: "desc" } } },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Household not found.");
  return row;
}

async function requireRole(userId: string, householdId: string, minimum: HouseholdRole) {
  const member = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!member || member.status !== "ACTIVE" || RANK[member.role] < RANK[minimum]) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Insufficient household permission.");
  }
  return member;
}

export async function inviteMember(userId: string, householdId: string, inviteeId: string, role: HouseholdRole = "MEMBER") {
  await requireRole(userId, householdId, "ADMIN");
  if (role === "OWNER") throw new ApiError(400, "VALIDATION_ERROR", "The owner role cannot be assigned.");
  const row = await prisma.householdMember.upsert({
    where: { householdId_userId: { householdId, userId: inviteeId } },
    create: { householdId, userId: inviteeId, role, status: "ACTIVE", joinedAt: new Date() },
    update: { role, status: "ACTIVE" },
  });
  await securityAudit({
    actorType: "USER", actorId: userId, action: "HOUSEHOLD_MEMBER_INVITED",
    targetType: "household", targetId: householdId, metadata: { inviteeId, role },
  });
  return row;
}

export async function listHouseholdBills(userId: string, householdId: string) {
  await requireRole(userId, householdId, "VIEWER");
  return prisma.householdBillAssignment.findMany({ where: { householdId }, orderBy: { createdAt: "desc" }, take: 100 });
}

/**
 * Sharing a bill only records responsibility. It never moves money, creates a
 * group debt, or authorises another member to pay.
 */
export async function assignHouseholdBill(userId: string, householdId: string, input: HouseholdBillInput) {
  await requireRole(userId, householdId, "MEMBER");
  if (input.assignedTo) {
    const assignee = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: input.assignedTo } },
    });
    if (!assignee || assignee.status !== "ACTIVE") throw new ApiError(400, "VALIDATION_ERROR", "Assignee is not an active household member.");
  }
  const row = await prisma.householdBillAssignment.create({
    data: {
      householdId, billerId: input.billerId, accountId: input.accountId ?? null,
      paymentId: input.paymentId ?? null, assignedTo: input.assignedTo ?? null,
      createdBy: userId, note: input.note ?? null,
    },
  });
  await securityAudit({
    actorType: "USER", actorId: userId, action: "HOUSEHOLD_BILL_ASSIGNED",
    targetType: "household_bill_assignment", targetId: row.id,
    metadata: { householdId, assignedTo: input.assignedTo },
  });
  return row;
}

export async function setBillSettled(userId: string, householdId: string, assignmentId: string, settled: boolean) {
  await requireRole(userId, householdId, "MEMBER");
  const row = await prisma.householdBillAssignment.findFirst({ where: { id: assignmentId, householdId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Assignment not found.");
  return prisma.householdBillAssignment.update({ where: { id: assignmentId }, data: { settled } });
}

export const HOUSEHOLD_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
