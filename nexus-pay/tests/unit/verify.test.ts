import { describe, expect, it } from "vitest";
import type { RaftlineTransactionReceipt } from "../../packages/api-client/src/index";
import { verifyFundingReceipt, verifySettlementReceipt } from "../../apps/web/lib/payments/verify";

const now = Date.now();

function settledReceipt(overrides: Partial<RaftlineTransactionReceipt> = {}): RaftlineTransactionReceipt {
  return {
    paymentRef: "pmt_release2_0001",
    idempotencyKey: "np-key-0001",
    status: "SETTLED",
    rail: "INTERNAL_BOOK",
    sourceAccountId: "np_alice",
    destinationAccountId: "np_bob",
    amountCents: 50000,
    currency: "INR",
    sourceBalanceAfter: 150000,
    destinationBalanceAfter: 200000,
    rejectionReason: null,
    settledAt: now - 2000,
    raftLogIndex: 918,
    isIdempotentReplay: false,
    ...overrides,
  };
}

const settlementExpected = {
  idempotencyKey: "np-key-0001",
  amountMinor: 50000,
  currency: "INR",
  sourceAccountId: "np_alice",
  destinationAccountId: "np_bob",
};

const fundingExpected = {
  idempotencyKey: "np-key-0001",
  amountMinor: 50000,
  currency: "INR",
  accountId: "np_alice",
};

function fundingReceipt(overrides: Partial<RaftlineTransactionReceipt> = {}): RaftlineTransactionReceipt {
  return settledReceipt({
    paymentRef: "pmt_fund_0001",
    sourceAccountId: "SYSTEM_RESERVE",
    destinationAccountId: "np_alice",
    sourceBalanceAfter: 0,
    destinationBalanceAfter: 50000,
    ...overrides,
  });
}

describe("settlement receipt verification", () => {
  it("accepts a matching committed internal-book receipt", () => {
    const verdict = verifySettlementReceipt(settledReceipt(), settlementExpected);
    expect(verdict).toMatchObject({
      type: "SETTLED",
      paymentRef: "pmt_release2_0001",
      amountMinor: 50000,
      raftLogIndex: 918,
    });
    if (verdict.type === "SETTLED") {
      expect(verdict.idempotentReplay).toBe(false);
      expect(verdict.settledAt).toBeInstanceOf(Date);
    }
  });

  it("preserves a verified idempotent replay", () => {
    const verdict = verifySettlementReceipt(
      settledReceipt({ isIdempotentReplay: true }),
      settlementExpected,
    );
    expect(verdict.type).toBe("SETTLED");
    if (verdict.type === "SETTLED") expect(verdict.idempotentReplay).toBe(true);
  });

  it("rejects receipts that do not match the instruction", () => {
    const cases: Partial<RaftlineTransactionReceipt>[] = [
      { idempotencyKey: "np-key-9999" },
      { amountCents: 50001 },
      { currency: "USD" },
      { destinationAccountId: "np_mallory" },
      { sourceAccountId: "np_mallory" },
    ];
    for (const change of cases) {
      const verdict = verifySettlementReceipt(
        settledReceipt(change),
        settlementExpected,
      );
      expect(verdict.type).toBe("MISMATCH");
    }
  });

  it("rejects unexpected rails, implausible timestamps and inconsistent balances", () => {
    expect(
      verifySettlementReceipt(settledReceipt({ rail: "EXTERNAL_UPI" }), settlementExpected).type,
    ).toBe("MISMATCH");
    expect(
      verifySettlementReceipt(settledReceipt({ settledAt: now + 60 * 60 * 1000 }), settlementExpected)
        .type,
    ).toBe("MISMATCH");
    expect(
      verifySettlementReceipt(settledReceipt({ sourceBalanceAfter: -1 }), settlementExpected).type,
    ).toBe("MISMATCH");
    expect(
      verifySettlementReceipt(settledReceipt({ status: "PROCESSING" }), settlementExpected).type,
    ).toBe("MISMATCH");
  });

  it("maps definitive rejections to a safe message and never to success", () => {
    const verdict = verifySettlementReceipt(
      settledReceipt({
        status: "REJECTED",
        rejectionReason: "INSUFFICIENT_FUNDS",
      }),
      settlementExpected,
    );
    expect(verdict.type).toBe("REJECTED");
    if (verdict.type === "REJECTED") {
      expect(verdict.code).toBe("INSUFFICIENT_FUNDS");
      expect(verdict.message).toContain("balance is too low");
    }
  });
});

describe("funding receipt verification", () => {
  it("accepts a committed simulated reserve credit", () => {
    const verdict = verifyFundingReceipt(fundingReceipt(), fundingExpected);
    expect(verdict).toMatchObject({
      type: "COMPLETED",
      fundingRef: "pmt_fund_0001",
      balanceAfterMinor: 50000,
    });
    if (verdict.type === "COMPLETED") expect(verdict.settledAt).toBeInstanceOf(Date);
  });

  it("rejects wrong source, non-zero reserve balance and impossible destination balance", () => {
    expect(
      verifyFundingReceipt(fundingReceipt({ sourceAccountId: "np_alice" }), fundingExpected).type,
    ).toBe("MISMATCH");
    expect(
      verifyFundingReceipt(fundingReceipt({ sourceBalanceAfter: 100 }), fundingExpected).type,
    ).toBe("MISMATCH");
    expect(
      verifyFundingReceipt(fundingReceipt({ destinationBalanceAfter: 100 }), fundingExpected).type,
    ).toBe("MISMATCH");
  });

  it("treats a non-settled funding receipt as failed, never as completed", () => {
    const verdict = verifyFundingReceipt(
      fundingReceipt({ status: "REJECTED", rejectionReason: "FUNDING_REJECTED" }),
      fundingExpected,
    );
    expect(verdict.type).toBe("FAILED");
  });
});
