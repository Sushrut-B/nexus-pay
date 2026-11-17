import type {
  FundingOperation,
  PaymentIntent,
  TransactionRecord,
} from "@nexus/database";
import {
  SIMULATED_FUNDING_DISCLOSURE,
  type FundingView,
  type LedgerVerification,
  type PaymentIntentStatus,
  type PaymentView,
  type TransactionSummary,
} from "@nexus/shared-types";
import { maskAccountId } from "@/lib/format";

export function toSafeMinor(value: bigint | number | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric)) {
    throw new RangeError("A stored money amount is outside the safe integer range");
  }
  return numeric;
}

export function paymentTransactionStatus(
  status: PaymentIntentStatus,
): TransactionSummary["status"] {
  switch (status) {
    case "SETTLED":
      return "SUCCESSFUL";
    case "REJECTED":
      return "FAILED";
    case "UNKNOWN":
    case "RECONCILIATION_REQUIRED":
      return "RECONCILIATION_REQUIRED";
    case "CREATED":
    case "PROCESSING":
    default:
      return "PROCESSING";
  }
}

export function toTransactionSummary(record: TransactionRecord): TransactionSummary {
  return {
    id: record.id,
    kind: record.kind,
    direction: record.direction,
    status: record.status,
    amountMinor: toSafeMinor(record.amountMinor) ?? 0,
    currency: record.currency,
    counterpartyName: record.counterpartyName,
    counterpartyUsername: record.counterpartyUsername,
    description: record.description,
    paymentRef: record.paymentRef,
    occurredAt: record.occurredAt.toISOString(),
    simulatedFunding: record.kind === "FUNDING",
  };
}

export function toPaymentView(
  intent: PaymentIntent,
  transaction: TransactionRecord | null,
): PaymentView {
  return {
    id: intent.id,
    status: intent.status,
    transactionStatus: transaction?.status ?? paymentTransactionStatus(intent.status),
    amountMinor: toSafeMinor(intent.amountMinor) ?? 0,
    currency: intent.currency,
    recipient: {
      displayName: intent.recipientDisplayName,
      username: intent.recipientUsername,
    },
    sourceAccountMasked: maskAccountId(intent.sourceAccountId),
    description: intent.description,
    paymentRef: intent.paymentRef,
    rejectionCode: intent.rejectionCode,
    failureMessage: intent.failureMessage,
    createdAt: intent.createdAt.toISOString(),
    settledAt: intent.settledAt?.toISOString() ?? null,
    idempotentReplay: intent.lastWasIdempotentReplay,
    verification: settlementVerification(intent),
    transaction: transaction ? toTransactionSummary(transaction) : null,
  };
}

export function toFundingView(
  operation: FundingOperation,
  transaction: TransactionRecord | null,
): FundingView {
  return {
    id: operation.id,
    status: operation.status,
    transactionStatus:
      transaction?.status ??
      (operation.status === "COMPLETED"
        ? "SUCCESSFUL"
        : operation.status === "FAILED"
          ? "FAILED"
          : operation.status === "UNKNOWN" ||
              operation.status === "RECONCILIATION_REQUIRED"
            ? "RECONCILIATION_REQUIRED"
            : "PROCESSING"),
    amountMinor: toSafeMinor(operation.amountMinor) ?? 0,
    currency: operation.currency,
    fundingRef: operation.fundingRef,
    balanceAfterMinor: toSafeMinor(operation.balanceAfterMinor),
    failureCode: operation.failureCode,
    failureMessage: operation.failureMessage,
    createdAt: operation.createdAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
    simulated: true,
    disclosure: SIMULATED_FUNDING_DISCLOSURE,
    idempotentReplay: operation.lastWasIdempotentReplay,
    verification: fundingVerification(operation),
    transaction: transaction ? toTransactionSummary(transaction) : null,
  };
}

function settlementVerification(intent: PaymentIntent): LedgerVerification {
  return {
    receiptVerified: intent.receiptVerifiedAt !== null,
    verifiedAt: intent.receiptVerifiedAt?.toISOString() ?? null,
    ledgerStatus: intent.status === "SETTLED" ? "SETTLED" : null,
    raftLogIndex: intent.raftLogIndex === null ? null : toSafeMinor(intent.raftLogIndex),
    raftLogIndexAvailable: intent.raftLogIndex !== null && intent.raftLogIndex > 0n,
    note:
      intent.receiptVerifiedAt !== null
        ? "The outcome was read back from the replicated Raftline ledger."
        : "No verified ledger receipt has been recorded for this payment.",
  };
}

function fundingVerification(operation: FundingOperation): LedgerVerification {
  return {
    receiptVerified: operation.receiptVerifiedAt !== null,
    verifiedAt: operation.receiptVerifiedAt?.toISOString() ?? null,
    ledgerStatus: operation.status === "COMPLETED" ? "SETTLED" : null,
    raftLogIndex: null,
    raftLogIndexAvailable: false,
    note:
      operation.receiptVerifiedAt !== null
        ? "The funding receipt was read back from the replicated Raftline ledger. Raftline currently serialises funding receipts before assigning a log index, so the index is unavailable."
        : "No verified funding receipt has been recorded for this operation.",
  };
}
