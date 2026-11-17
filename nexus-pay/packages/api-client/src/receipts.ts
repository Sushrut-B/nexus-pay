import { z } from "zod";
import { RaftlineError } from "./errors";

const rawReceiptSchema = z.object({
  paymentRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: z.string().min(1),
  rail: z.string().optional().default(""),
  sourceAccountId: z.string().nullable().optional().default(null),
  destinationAccountId: z.string().nullable().optional().default(null),
  amountCents: z.number().int().finite(),
  currency: z.string().min(3).max(3),
  sourceBalanceAfter: z.number().int().finite(),
  destinationBalanceAfter: z.number().int().finite(),
  rejectionReason: z.string().nullable().optional().default(null),
  settledAt: z.number().int().finite(),
  raftLogIndex: z.number().int().finite().optional().default(0),
  isIdempotentReplay: z.boolean().optional().default(false),
});

export interface RaftlineTransactionReceipt {
  paymentRef: string;
  idempotencyKey: string;
  status: string;
  rail: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  amountCents: number;
  currency: string;
  sourceBalanceAfter: number;
  destinationBalanceAfter: number;
  rejectionReason: string | null;
  settledAt: number;
  raftLogIndex: number;
  isIdempotentReplay: boolean;
}

export function parseTransactionReceipt(raw: string): RaftlineTransactionReceipt {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RaftlineError("Raftline returned an invalid transaction receipt", {
      code: "BAD_RESPONSE",
    });
  }

  const parsed = rawReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new RaftlineError("Raftline transaction receipt has an unexpected shape", {
      code: "BAD_RESPONSE",
    });
  }
  return parsed.data;
}

export function isSettledReceipt(receipt: RaftlineTransactionReceipt): boolean {
  return receipt.status.toUpperCase() === "SETTLED";
}

export function isRejectedReceipt(receipt: RaftlineTransactionReceipt): boolean {
  return receipt.status.toUpperCase() === "REJECTED";
}

/**
 * A ledger receipt only proves this customer's operation when every immutable
 * identifier and amount matches the instruction Nexus Pay sent.
 */
export function receiptMatches(input: {
  receipt: RaftlineTransactionReceipt;
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  sourceAccountId?: string;
  destinationAccountId: string;
}): boolean {
  const receipt = input.receipt;
  if (receipt.idempotencyKey !== input.idempotencyKey) return false;
  if (receipt.amountCents !== input.amountCents) return false;
  if (receipt.currency.toUpperCase() !== input.currency.toUpperCase()) return false;
  if (receipt.destinationAccountId !== input.destinationAccountId) return false;
  if (input.sourceAccountId && receipt.sourceAccountId !== input.sourceAccountId) return false;
  return true;
}
