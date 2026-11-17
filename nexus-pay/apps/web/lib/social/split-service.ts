/**
 * Deterministic expense-split calculations. All money is integer minor units.
 *
 * Remainder rule (largest remainder, stable tie-break):
 *   For each participant i with weight w_i and total weight W, the exact share
 *   is total * w_i / W. We allocate floor(total * w_i / W) paise first, then
 *   hand out the remaining paise one at a time to the participants with the
 *   largest fractional remainders (total * w_i mod W). Ties are broken by the
 *   participant's original position, so the same input always yields the same
 *   allocation. The sum always equals the expense total exactly.
 */

import type { SplitMethod } from "@nexus/shared-types";

export interface SplitParticipantInput {
  userId: string;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

export interface Allocation {
  userId: string;
  amountMinor: number;
  percentage: number | null;
  shares: number | null;
}

function assertSafeTotal(totalMinor: number): void {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new Error("The expense total must be a positive integer in minor units");
  }
}

function assertUniqueParticipants(participants: SplitParticipantInput[]): void {
  if (participants.length === 0) throw new Error("Select at least one participant");
  const seen = new Set<string>();
  for (const participant of participants) {
    if (!participant.userId) throw new Error("A participant is missing an identifier");
    if (seen.has(participant.userId)) {
      throw new Error("The same person cannot appear twice in one expense");
    }
    seen.add(participant.userId);
  }
}

function weightedAllocation(
  totalMinor: number,
  participants: SplitParticipantInput[],
  weights: number[],
): Allocation[] {
  assertSafeTotal(totalMinor);
  assertUniqueParticipants(participants);
  if (weights.length !== participants.length) throw new Error("Allocation mismatch");

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("The allocation weights must be greater than zero");

  const total = BigInt(totalMinor);
  const weightsBig = weights.map((weight) => BigInt(weight));
  const weightTotalBig = BigInt(totalWeight);

  const base = weightsBig.map((weight) => Number((total * weight) / weightTotalBig));
  const remainders = weightsBig.map((weight) => total * weight - (total * weight / weightTotalBig) * weightTotalBig);
  let leftover = totalMinor - base.reduce((sum, value) => sum + value, 0);

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });

  for (let cursor = 0; leftover > 0; cursor += 1, leftover -= 1) {
    const target = order[cursor % order.length]!;
    base[target.index] = base[target.index]! + 1;
  }

  return participants.map((participant, index) => ({
    userId: participant.userId,
    amountMinor: base[index]!,
    percentage: null,
    shares: null,
  }));
}

export function allocateEqual(totalMinor: number, participants: SplitParticipantInput[]): Allocation[] {
  return weightedAllocation(
    totalMinor,
    participants,
    participants.map(() => 1),
  );
}

export function allocateCustom(totalMinor: number, participants: SplitParticipantInput[]): Allocation[] {
  assertSafeTotal(totalMinor);
  assertUniqueParticipants(participants);
  const allocations = participants.map((participant) => {
    const amount = participant.amountMinor;
    if (!Number.isSafeInteger(amount) || amount === undefined || amount < 0) {
      throw new Error("Enter an exact non-negative amount for every participant");
    }
    return {
      userId: participant.userId,
      amountMinor: amount,
      percentage: null,
      shares: null,
    };
  });
  const sum = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new Error(`The custom amounts must add up to the expense total (off by ${sum - totalMinor})`);
  }
  return allocations;
}

export function allocatePercentage(
  totalMinor: number,
  participants: SplitParticipantInput[],
): Allocation[] {
  assertSafeTotal(totalMinor);
  assertUniqueParticipants(participants);
  const percentages = participants.map((participant) => {
    const value = participant.percentage;
    if (!Number.isSafeInteger(value) || value === undefined || value < 0 || value > 100) {
      throw new Error("Enter a whole percentage between 0 and 100 for every participant");
    }
    return value;
  });
  if (percentages.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error("Percentages must add up to exactly 100");
  }
  const allocations = weightedAllocation(totalMinor, participants, percentages);
  return allocations.map((allocation, index) => ({ ...allocation, percentage: percentages[index]! }));
}

export function allocateShares(totalMinor: number, participants: SplitParticipantInput[]): Allocation[] {
  assertSafeTotal(totalMinor);
  assertUniqueParticipants(participants);
  const shares = participants.map((participant) => {
    const value = participant.shares;
    if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
      throw new Error("Enter a non-negative whole number of shares for every participant");
    }
    return value;
  });
  const allocations = weightedAllocation(totalMinor, participants, shares);
  return allocations.map((allocation, index) => ({ ...allocation, shares: shares[index]! }));
}

export function calculateSplit(
  method: SplitMethod,
  totalMinor: number,
  participants: SplitParticipantInput[],
): Allocation[] {
  switch (method) {
    case "EQUAL":
      return allocateEqual(totalMinor, participants);
    case "CUSTOM":
      return allocateCustom(totalMinor, participants);
    case "PERCENTAGE":
      return allocatePercentage(totalMinor, participants);
    case "SHARES":
      return allocateShares(totalMinor, participants);
    default:
      throw new Error("Unsupported split method");
  }
}
