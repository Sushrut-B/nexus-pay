/**
 * Group balance engine (Release 3).
 *
 * Net balance = total paid by a member − their assigned expense shares
 *              + settlements they paid − settlements they received.
 *
 * Positive = the group owes the member. Negative = the member owes the group.
 * Only settlements with a verified, successful payment are passed in by the
 * caller; processing or unknown payments never affect a balance.
 *
 * All arithmetic is integer minor units. The sum of all net balances must be
 * zero; an invariant failure is surfaced instead of showing misleading values.
 */

export interface BalanceExpenseInput {
  id: string;
  totalAmountMinor: number;
  paidByUserId: string;
  splits: Array<{ userId: string; shareAmountMinor: number }>;
}

export interface BalanceSettlementInput {
  id: string;
  payerUserId: string;
  payeeUserId: string;
  amountMinor: number;
}

export interface MemberBalance {
  userId: string;
  netMinor: number;
}

export class BalanceEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceEngineError";
  }
}

function safeMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new BalanceEngineError(`${label} is not a safe integer amount`);
  }
  return value;
}

export function computeGroupBalances(
  memberUserIds: string[],
  expenses: BalanceExpenseInput[],
  settlements: BalanceSettlementInput[],
): MemberBalance[] {
  const members = [...new Set(memberUserIds)];
  if (members.length === 0) return [];

  const nets = new Map<string, number>(members.map((userId) => [userId, 0]));
  const adjust = (userId: string, delta: number) => {
    if (!nets.has(userId)) {
      throw new BalanceEngineError(`A transaction references someone who is not in the group`);
    }
    nets.set(userId, nets.get(userId)! + delta);
  };

  for (const expense of expenses) {
    const total = safeMinor(expense.totalAmountMinor, "Expense total");
    if (!nets.has(expense.paidByUserId)) {
      throw new BalanceEngineError("An expense was paid by someone outside the group");
    }
    adjust(expense.paidByUserId, total);

    let splitTotal = 0;
    const seen = new Set<string>();
    for (const split of expense.splits) {
      if (seen.has(split.userId)) {
        throw new BalanceEngineError("An expense contains a duplicate participant share");
      }
      seen.add(split.userId);
      const share = safeMinor(split.shareAmountMinor, "Expense share");
      if (share < 0) throw new BalanceEngineError("An expense share cannot be negative");
      splitTotal += share;
      adjust(split.userId, -share);
    }
    if (splitTotal !== total) {
      throw new BalanceEngineError("An expense shares do not add up to its total");
    }
  }

  for (const settlement of settlements) {
    const amount = safeMinor(settlement.amountMinor, "Settlement amount");
    if (amount <= 0) throw new BalanceEngineError("A settlement amount must be positive");
    adjust(settlement.payerUserId, amount);
    adjust(settlement.payeeUserId, -amount);
  }

  const balances = members.map((userId) => ({ userId, netMinor: nets.get(userId)! }));
  const sum = balances.reduce((total, entry) => total + entry.netMinor, 0);
  if (sum !== 0) {
    throw new BalanceEngineError(`Group balance invariant failed: net balances sum to ${sum}`);
  }
  return balances;
}

export interface SuggestedTransfer {
  payerUserId: string;
  payeeUserId: string;
  amountMinor: number;
}

/**
 * Greedy debt simplification. Creditors and debtors are sorted deterministically
 * by amount then user id, so repeated calls produce identical plans. This is a
 * presentation aid only: individual obligations remain recorded in the expenses.
 */
export function simplifyDebts(balances: MemberBalance[]): SuggestedTransfer[] {
  const creditors = balances
    .filter((entry) => entry.netMinor > 0)
    .map((entry) => ({ userId: entry.userId, remaining: entry.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || a.userId.localeCompare(b.userId));

  const debtors = balances
    .filter((entry) => entry.netMinor < 0)
    .map((entry) => ({ userId: entry.userId, remaining: -entry.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || a.userId.localeCompare(b.userId));

  const transfers: SuggestedTransfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]!;
    const debtor = debtors[debtorIndex]!;
    const amount = Math.min(creditor.remaining, debtor.remaining);
    if (amount > 0) {
      transfers.push({
        payerUserId: debtor.userId,
        payeeUserId: creditor.userId,
        amountMinor: amount,
      });
    }
    creditor.remaining -= amount;
    debtor.remaining -= amount;
    if (creditor.remaining === 0) creditorIndex += 1;
    if (debtor.remaining === 0) debtorIndex += 1;
  }

  return transfers;
}

/** Largest outstanding debt for a given member, after simplified planning. */
export function outstandingFor(balances: MemberBalance[], userId: string): number {
  const entry = balances.find((item) => item.userId === userId);
  if (!entry) return 0;
  return entry.netMinor < 0 ? -entry.netMinor : 0;
}
