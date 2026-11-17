import { prisma, type Expense } from "@nexus/database";
import type { ExpenseListResult, ExpenseView, ExpenseSplitView } from "@nexus/shared-types";
import type { ExpenseCreateInput, ExpenseUpdateInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import { calculateSplit } from "@/lib/social/split-service";
import { assertMembership } from "@/lib/social/group-service";
import { createNotification, loadParty, recordActivity } from "@/lib/social/shared";

type ExpenseWithRelations = Expense & {
  paidBy: { id: string; username: string; fullName: string; profile: { displayName: string } | null };
  splits: Array<{
    userId: string;
    shareAmountMinor: bigint;
    percentage: number | null;
    shares: number | null;
    user: { id: string; username: string; fullName: string; profile: { displayName: string } | null };
  }>;
};

const expenseInclude = {
  paidBy: { include: { profile: true } },
  splits: { include: { user: { include: { profile: true } } }, orderBy: { userId: "asc" } },
} as const;

async function assertActiveMembers(
  groupId: string,
  userIds: string[],
  action: string,
): Promise<void> {
  const unique = [...new Set(userIds)];
  const count = await prisma.groupMember.count({
    where: { groupId, userId: { in: unique }, removedAt: null },
  });
  if (count !== unique.length) {
    throw new ApiError(
      400,
      "PAYMENT_ERROR",
      `${action} must be current members of this group.`,
    );
  }
}

async function hasSettledExpenses(groupId: string): Promise<boolean> {
  const settled = await prisma.groupSettlement.count({
    where: { groupId, status: "SETTLED" },
  });
  return settled > 0;
}

function toView(expense: ExpenseWithRelations): ExpenseView {
  const splits: ExpenseSplitView[] = expense.splits.map((split) => ({
    userId: split.userId,
    displayName: split.user.profile?.displayName ?? split.user.fullName,
    username: split.user.username,
    shareAmountMinor: Number(split.shareAmountMinor),
    percentage: split.percentage,
    shares: split.shares,
  }));
  return {
    id: expense.id,
    groupId: expense.groupId,
    title: expense.title,
    description: expense.description,
    totalAmountMinor: Number(expense.totalAmountMinor),
    currency: expense.currency,
    payer: {
      userId: expense.paidBy.id,
      displayName: expense.paidBy.profile?.displayName ?? expense.paidBy.fullName,
      username: expense.paidBy.username,
    },
    splitMethod: expense.splitMethod,
    expenseDate: expense.expenseDate.toISOString(),
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    deletedAt: expense.deletedAt?.toISOString() ?? null,
    splits,
  };
}

async function loadExpense(groupId: string, expenseId: string): Promise<ExpenseWithRelations> {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId, deletedAt: null },
    include: expenseInclude,
  });
  if (!expense) {
    throw new ApiError(404, "PAYMENT_ERROR", "That group expense could not be found.");
  }
  return expense as ExpenseWithRelations;
}

export async function createExpense(
  userId: string,
  groupId: string,
  input: ExpenseCreateInput,
): Promise<ExpenseView> {
  await assertMembership(userId, groupId);
  const participantIds = input.participants.map((participant) => participant.userId);
  await assertActiveMembers(groupId, [input.paidByUserId, ...participantIds], "The payer and participants must");

  let allocations;
  try {
    allocations = calculateSplit(input.splitMethod, input.totalAmountMinor, input.participants);
  } catch (error) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "The expense split is invalid.",
    );
  }

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        groupId,
        title: input.title,
        description: input.description ?? input.notes ?? null,
        totalAmountMinor: BigInt(input.totalAmountMinor),
        currency: "INR",
        paidByUserId: input.paidByUserId,
        splitMethod: input.splitMethod,
        expenseDate: new Date(`${input.expenseDate}T00:00:00.000Z`),
        createdByUserId: userId,
        splits: {
          create: allocations.map((allocation) => ({
            userId: allocation.userId,
            shareAmountMinor: BigInt(allocation.amountMinor),
            percentage: allocation.percentage,
            shares: allocation.shares,
          })),
        },
      },
      include: expenseInclude,
    });
    const me = await loadParty(tx, userId);
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "EXPENSE_CREATED",
      entityType: "expense",
      entityId: created.id,
      metadata: { title: created.title, amountMinor: input.totalAmountMinor },
    });
    for (const participantId of participantIds) {
      if (participantId === userId) continue;
      await createNotification(tx, {
        userId: participantId,
        type: "GROUP_EXPENSE_CREATED",
        title: `New expense: ${created.title}`,
        body: `${me.displayName} added an expense you share.`,
        data: { groupId, expenseId: created.id, amountMinor: input.totalAmountMinor },
      });
    }
    return created;
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
    entityType: "expense",
    entityId: expense.id,
    metadata: { groupId, amountMinor: input.totalAmountMinor, splitMethod: input.splitMethod },
  });

  return toView(expense as ExpenseWithRelations);
}

export async function listExpenses(
  userId: string,
  groupId: string,
): Promise<ExpenseListResult> {
  await assertMembership(userId, groupId);
  const expenses = await prisma.expense.findMany({
    where: { groupId, deletedAt: null },
    include: expenseInclude,
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
  });
  return {
    items: (expenses as ExpenseWithRelations[]).map(toView),
    total: expenses.length,
  };
}

export async function getExpense(
  userId: string,
  groupId: string,
  expenseId: string,
): Promise<ExpenseView> {
  await assertMembership(userId, groupId);
  return toView(await loadExpense(groupId, expenseId));
}

export async function updateExpense(
  userId: string,
  groupId: string,
  expenseId: string,
  input: ExpenseUpdateInput,
): Promise<ExpenseView> {
  await assertMembership(userId, groupId);
  const existing = await loadExpense(groupId, expenseId);

  const totalMinor = input.totalAmountMinor ?? Number(existing.totalAmountMinor);
  const method = input.splitMethod ?? existing.splitMethod;
  const payerId = input.paidByUserId ?? existing.paidByUserId;
  const participants = input.participants ?? existing.splits.map((split) => ({
    userId: split.userId,
    amountMinor: split.percentage !== null || split.shares !== null ? Number(split.shareAmountMinor) : undefined,
    percentage: split.percentage ?? undefined,
    shares: split.shares ?? undefined,
  }));

  await assertActiveMembers(groupId, [payerId, ...participants.map((p) => p.userId)], "The payer and participants must");

  let allocations;
  try {
    allocations = calculateSplit(method, totalMinor, participants);
  } catch (error) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "The expense split is invalid.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.expense.update({
      where: { id: existing.id },
      data: {
        title: input.title ?? existing.title,
        description:
          input.description === null
            ? null
            : input.description ?? input.notes ?? existing.description,
        totalAmountMinor: BigInt(totalMinor),
        category: input.category ?? existing.category,
        expenseDate: input.expenseDate
          ? new Date(`${input.expenseDate}T00:00:00.000Z`)
          : existing.expenseDate,
        paidByUserId: payerId,
        splitMethod: method,
        splits: {
          deleteMany: {},
          create: allocations.map((allocation) => ({
            userId: allocation.userId,
            shareAmountMinor: BigInt(allocation.amountMinor),
            percentage: allocation.percentage,
            shares: allocation.shares,
          })),
        },
      },
      include: expenseInclude,
    });
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "EXPENSE_UPDATED",
      entityType: "expense",
      entityId: existing.id,
      metadata: {
        title: result.title,
        reason: input.reason,
        previousAmountMinor: Number(existing.totalAmountMinor),
      },
    });
    for (const participantId of participants.map((p) => p.userId)) {
      if (participantId === userId) continue;
      await createNotification(tx, {
        userId: participantId,
        type: "GROUP_EXPENSE_UPDATED",
        title: `Expense updated: ${result.title}`,
        body: `${input.reason} — balances were recalculated.`,
        data: { groupId, expenseId: existing.id },
      });
    }
    return result;
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
    entityType: "expense",
    entityId: existing.id,
    metadata: { groupId, reason: input.reason, previousAmountMinor: Number(existing.totalAmountMinor) },
  });

  return toView(updated as ExpenseWithRelations);
}

export async function deleteExpense(
  userId: string,
  groupId: string,
  expenseId: string,
): Promise<void> {
  await assertMembership(userId, groupId);
  const existing = await loadExpense(groupId, expenseId);
  if (await hasSettledExpenses(groupId)) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "This group has completed settlements. The expense cannot be removed because balances already reflect it.",
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    await recordActivity(tx, {
      groupId,
      actorUserId: userId,
      eventType: "EXPENSE_DELETED",
      entityType: "expense",
      entityId: existing.id,
      metadata: { title: existing.title },
    });
  });
}
