import { prisma } from "@nexus/database";
import type {
  BalanceEntry,
  GroupBalances,
  SocialParty,
  SuggestedSettlement,
} from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import {
  BalanceEngineError,
  computeGroupBalances,
  simplifyDebts,
} from "@/lib/social/balance-engine";
import { toSocialParty } from "@/lib/social/shared";

function consistencyError(error: unknown): never {
  if (error instanceof BalanceEngineError) {
    throw new ApiError(500, "INTERNAL_SERVER_ERROR", error.message);
  }
  throw error;
}

export async function loadGroupBalanceData(groupId: string) {
  const [group, expenses, settlements] = await Promise.all([
    prisma.expenseGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { removedAt: null },
          include: { user: { include: { profile: true } } },
        },
      },
    }),
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      include: { splits: true },
      orderBy: { expenseDate: "asc" },
    }),
    prisma.groupSettlement.findMany({
      where: { groupId, status: "SETTLED" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!group) {
    throw new ApiError(404, "PAYMENT_ERROR", "That group could not be found.");
  }
  return { group, expenses, settlements };
}

export async function getGroupBalances(groupId: string): Promise<GroupBalances> {
  const { group, expenses, settlements } = await loadGroupBalanceData(groupId);
  const parties = new Map<string, SocialParty>(
    group.members.map((member) => [member.userId, toSocialParty(member.user)]),
  );

  try {
    const balances = computeGroupBalances(
      [...parties.keys()],
      expenses.map((expense) => ({
        id: expense.id,
        totalAmountMinor: Number(expense.totalAmountMinor),
        paidByUserId: expense.paidByUserId,
        splits: expense.splits.map((split) => ({
          userId: split.userId,
          shareAmountMinor: Number(split.shareAmountMinor),
        })),
      })),
      settlements.map((settlement) => ({
        id: settlement.id,
        payerUserId: settlement.payerUserId,
        payeeUserId: settlement.payeeUserId,
        amountMinor: Number(settlement.amountMinor),
      })),
    );

    const entries: BalanceEntry[] = balances.map((balance) => ({
      user: parties.get(balance.userId)!,
      netMinor: balance.netMinor,
    }));

    return {
      groupId,
      entries,
      sumMinor: balances.reduce((sum, balance) => sum + balance.netMinor, 0),
      consistent: true,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    consistencyError(error);
  }
}

export async function getSuggestedSettlements(groupId: string): Promise<SuggestedSettlement[]> {
  const { group, expenses, settlements } = await loadGroupBalanceData(groupId);
  const parties = new Map<string, SocialParty>(
    group.members.map((member) => [member.userId, toSocialParty(member.user)]),
  );
  try {
    const balances = computeGroupBalances(
      [...parties.keys()],
      expenses.map((expense) => ({
        id: expense.id,
        totalAmountMinor: Number(expense.totalAmountMinor),
        paidByUserId: expense.paidByUserId,
        splits: expense.splits.map((split) => ({
          userId: split.userId,
          shareAmountMinor: Number(split.shareAmountMinor),
        })),
      })),
      settlements.map((settlement) => ({
        id: settlement.id,
        payerUserId: settlement.payerUserId,
        payeeUserId: settlement.payeeUserId,
        amountMinor: Number(settlement.amountMinor),
      })),
    );
    return simplifyDebts(balances).map((transfer) => ({
      payer: parties.get(transfer.payerUserId)!,
      payee: parties.get(transfer.payeeUserId)!,
      amountMinor: transfer.amountMinor,
    }));
  } catch (error) {
    consistencyError(error);
  }
}

export async function getMemberBalanceMinor(groupId: string, userId: string): Promise<number> {
  const balances = await getGroupBalances(groupId);
  return balances.entries.find((entry) => entry.user.userId === userId)?.netMinor ?? 0;
}

/**
 * Direct obligations between pairs of members, derived from expenses and
 * reduced only by confirmed settlements. This is the maximum a payer may
 * settle to a specific payee, so partial and pairwise settlement stays correct
 * even though the displayed balance is a group-wide net.
 */
export async function getPairwiseObligation(
  groupId: string,
  payerUserId: string,
  payeeUserId: string,
): Promise<number> {
  const { expenses, settlements } = await loadGroupBalanceData(groupId);
  const obligations = new Map<string, number>();
  const key = (debtor: string, creditor: string) => `${debtor}|${creditor}`;
  const add = (debtor: string, creditor: string, amount: number) => {
    obligations.set(key(debtor, creditor), (obligations.get(key(debtor, creditor)) ?? 0) + amount);
  };

  for (const expense of expenses) {
    for (const split of expense.splits) {
      if (split.userId !== expense.paidByUserId) {
        add(split.userId, expense.paidByUserId, Number(split.shareAmountMinor));
      }
    }
  }
  for (const settlement of settlements) {
    add(settlement.payerUserId, settlement.payeeUserId, -Number(settlement.amountMinor));
  }

  return Math.max(0, obligations.get(key(payerUserId, payeeUserId)) ?? 0);
}
