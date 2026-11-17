import {
  isRejectedReceipt,
  isSettledReceipt,
  receiptMatches,
  type RaftlineTransactionReceipt,
} from "@nexus/api-client";

const ACCEPTED_RAIL = "INTERNAL_BOOK";
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export type SettlementVerdict =
  | {
      type: "SETTLED";
      paymentRef: string;
      raftLogIndex: number | null;
      amountMinor: number;
      sourceBalanceAfter: number;
      destinationBalanceAfter: number;
      settledAt: Date;
      idempotentReplay: boolean;
    }
  | {
      type: "REJECTED";
      code: string;
      message: string;
      settledAt: Date | null;
    }
  | {
      type: "MISMATCH";
      message: string;
    };

export type FundingVerdict =
  | {
      type: "COMPLETED";
      fundingRef: string;
      balanceAfterMinor: number;
      settledAt: Date;
      idempotentReplay: boolean;
    }
  | {
      type: "FAILED";
      code: string;
      message: string;
    }
  | {
      type: "MISMATCH";
      message: string;
    };

/**
 * Returns a trustworthy receipt timestamp, or null when the ledger value is
 * missing, non-numeric, implausibly in the future, or otherwise unusable.
 * A receipt without a trustworthy timestamp is never treated as proof.
 */
function receiptTime(timestamp: number): Date | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) return null;
  return date;
}

function hasAcceptedRail(receipt: RaftlineTransactionReceipt): boolean {
  return receipt.rail.toUpperCase() === ACCEPTED_RAIL;
}

export function verifySettlementReceipt(
  receipt: RaftlineTransactionReceipt,
  expected: {
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
    sourceAccountId: string;
    destinationAccountId: string;
  },
): SettlementVerdict {
  if (
    !receiptMatches({
      receipt,
      idempotencyKey: expected.idempotencyKey,
      amountCents: expected.amountMinor,
      currency: expected.currency,
      sourceAccountId: expected.sourceAccountId,
      destinationAccountId: expected.destinationAccountId,
    })
  ) {
    return {
      type: "MISMATCH",
      message: "The ledger receipt does not match this payment. Verification is required.",
    };
  }

  if (!hasAcceptedRail(receipt)) {
    return {
      type: "MISMATCH",
      message: "The ledger receipt used an unexpected payment rail. Verification is required.",
    };
  }

  if (isSettledReceipt(receipt)) {
    const settledAt = receiptTime(receipt.settledAt);
    if (
      !settledAt ||
      !Number.isSafeInteger(receipt.sourceBalanceAfter) ||
      receipt.sourceBalanceAfter < 0 ||
      !Number.isSafeInteger(receipt.destinationBalanceAfter) ||
      receipt.destinationBalanceAfter < 0 ||
      receipt.amountCents !== expected.amountMinor ||
      receipt.paymentRef.trim().length === 0
    ) {
      return {
        type: "MISMATCH",
        message: "The ledger receipt contains inconsistent balance or timestamp data.",
      };
    }
    return {
      type: "SETTLED",
      paymentRef: receipt.paymentRef,
      raftLogIndex: receipt.raftLogIndex > 0 ? receipt.raftLogIndex : null,
      amountMinor: receipt.amountCents,
      sourceBalanceAfter: receipt.sourceBalanceAfter,
      destinationBalanceAfter: receipt.destinationBalanceAfter,
      settledAt,
      idempotentReplay: receipt.isIdempotentReplay,
    };
  }

  if (isRejectedReceipt(receipt)) {
    const code = receipt.rejectionReason ?? "PAYMENT_REJECTED";
    return {
      type: "REJECTED",
      code,
      message: rejectionMessage(code),
      settledAt: receiptTime(receipt.settledAt),
    };
  }

  return {
    type: "MISMATCH",
    message: "The ledger has not yet produced a final receipt for this payment.",
  };
}

export function verifyFundingReceipt(
  receipt: RaftlineTransactionReceipt,
  expected: {
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
    accountId: string;
  },
): FundingVerdict {
  if (
    !receiptMatches({
      receipt,
      idempotencyKey: expected.idempotencyKey,
      amountCents: expected.amountMinor,
      currency: expected.currency,
      destinationAccountId: expected.accountId,
    })
  ) {
    return {
      type: "MISMATCH",
      message: "The funding receipt does not match this request. Verification is required.",
    };
  }
  if (!hasAcceptedRail(receipt)) {
    return {
      type: "MISMATCH",
      message: "The funding receipt used an unexpected ledger rail. Verification is required.",
    };
  }
  if (receipt.sourceAccountId !== "SYSTEM_RESERVE") {
    return {
      type: "MISMATCH",
      message: "The funding receipt came from an unexpected source account.",
    };
  }
  if (!isSettledReceipt(receipt)) {
    return {
      type: "FAILED",
      code: receipt.rejectionReason ?? "FUNDING_NOT_SETTLED",
      message: "The simulated funding was not confirmed as settled.",
    };
  }
  const settledAt = receiptTime(receipt.settledAt);
  if (
    !settledAt ||
    receipt.sourceBalanceAfter !== 0 ||
    !Number.isSafeInteger(receipt.destinationBalanceAfter) ||
    receipt.destinationBalanceAfter < expected.amountMinor ||
    receipt.paymentRef.trim().length === 0
  ) {
    return {
      type: "MISMATCH",
      message: "The funding receipt contains inconsistent balance or timestamp data.",
    };
  }

  return {
    type: "COMPLETED",
    fundingRef: receipt.paymentRef,
    balanceAfterMinor: receipt.destinationBalanceAfter,
    settledAt,
    idempotentReplay: receipt.isIdempotentReplay,
  };
}

export function rejectionMessage(code: string): string {
  switch (code) {
    case "INSUFFICIENT_FUNDS":
      return "Your wallet balance is too low for this payment.";
    case "SOURCE_ACCOUNT_NOT_FOUND":
    case "DESTINATION_ACCOUNT_NOT_FOUND":
      return "A wallet linked to this payment could not be found. No money was sent.";
    case "CURRENCY_MISMATCH":
      return "The sender and recipient wallets use different currencies.";
    case "INVALID_AMOUNT_MUST_BE_POSITIVE":
      return "Enter a payment amount greater than zero.";
    case "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT":
      return "This payment reference was already used for a different request.";
    default:
      if (code.startsWith("SOURCE_ACCOUNT_") || code.startsWith("DESTINATION_ACCOUNT_")) {
        return "A wallet linked to this payment is not available. No money was sent.";
      }
      return "The payment was rejected by the ledger. No money was sent.";
  }
}
