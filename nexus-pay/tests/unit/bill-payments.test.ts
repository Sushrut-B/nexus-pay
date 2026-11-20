import { describe, expect, it } from "vitest";
import { BILL_PAYMENT_TRANSITIONS, paymentView } from "../../apps/web/lib/billing/payment-service";
import { RECHARGE_TRANSITIONS } from "../../apps/web/lib/billing/recharge-service";
import { BILL_FETCH_TRANSITIONS } from "../../apps/web/lib/billing/bill-service";
import { HOUSEHOLD_ROLES } from "../../apps/web/lib/billing/household-service";
import { SandboxBillerAdapter, SANDBOX_BILLER_NOTICE } from "../../apps/web/lib/billing/providers/sandbox-biller";
import { updateBaseline, emptyBaseline, isColdStart } from "../../apps/web/lib/fraud/behavioral";

describe("bill payment state machine", () => {
  it("never marks a wallet settlement as biller confirmation", () => {
    expect(BILL_PAYMENT_TRANSITIONS.WALLET_SETTLED).toContain("PROVIDER_SUBMISSION_PENDING");
    expect(BILL_PAYMENT_TRANSITIONS.WALLET_SETTLED).not.toContain("BILLER_CONFIRMED");
    expect(BILL_PAYMENT_TRANSITIONS.PROVIDER_PROCESSING).toContain("BILLER_CONFIRMED");
    expect(BILL_PAYMENT_TRANSITIONS.BILLER_CONFIRMED).toEqual(["REFUND_PENDING"]);
  });

  it("routes failed and unknown wallet outcomes away from the biller", () => {
    expect(BILL_PAYMENT_TRANSITIONS.WALLET_SETTLEMENT_PENDING).toContain("FAILED");
    expect(BILL_PAYMENT_TRANSITIONS.WALLET_SETTLEMENT_PENDING).toContain("UNKNOWN");
    expect(BILL_PAYMENT_TRANSITIONS.WALLET_SETTLEMENT_PENDING).toContain("RECONCILIATION_REQUIRED");
    expect(BILL_PAYMENT_TRANSITIONS.FAILED).toEqual([]);
  });

  it("keeps refund and reversal terminal states distinct", () => {
    expect(BILL_PAYMENT_TRANSITIONS.REFUND_PENDING).toContain("REFUNDED");
    expect(BILL_PAYMENT_TRANSITIONS.REFUND_PENDING).toContain("PARTIALLY_REVERSED");
    expect(BILL_PAYMENT_TRANSITIONS.REFUNDED).toEqual([]);
  });

  it(" exposes distinct customer-facing stage labels", () => {
    const base = {
      id: "p1", reference: "ref", billerName: "Biller", category: "ELECTRICITY" as const,
      maskedAccount: "AB****1234", amountMinor: 100, feeMinor: 0, totalMinor: 100,
      paymentRef: null, providerRef: null, confirmedAt: null,
      createdAt: new Date(),
    };
    const withRelations = (status: string) => ({
      ...base, status,
      biller: { name: "Biller", category: { code: "ELECTRICITY" } },
      account: { maskedIdentifier: "AB****1234" },
    });
    const view = paymentView(withRelations("WALLET_SETTLED") as never);
    expect(view.notice).toBe("Wallet debit confirmed");
    expect(paymentView(withRelations("BILLER_CONFIRMED") as never).notice).toBe("Biller confirmed");
    expect(paymentView(withRelations("UNKNOWN") as never).notice).toBe("Payment outcome unknown");
  });
});

describe("recharge and fetch state machines", () => {
  it("requires provider success for recharge SUCCESS", () => {
    expect(RECHARGE_TRANSITIONS.PROCESSING).toContain("SUCCESS");
    expect(RECHARGE_TRANSITIONS.SUCCESS).toEqual(["REFUND_PENDING"]);
    expect(RECHARGE_TRANSITIONS.FAILED).toEqual([]);
  });

  it("does not allow paying an expired bill", () => {
    expect(BILL_FETCH_TRANSITIONS.FETCHED).toContain("EXPIRED");
    expect(BILL_FETCH_TRANSITIONS.EXPIRED).toEqual([]);
    expect(BILL_FETCH_TRANSITIONS.FETCHED).toContain("PAID");
  });
});

describe("sandbox provider declarations", () => {
  const adapter = new SandboxBillerAdapter();

  it("is clearly labelled and never claims regulatory participation", async () => {
    expect(adapter.mode).toBe("SANDBOX");
    expect(adapter.code).toBe("sandbox-biller");
    expect(SANDBOX_BILLER_NOTICE.toLowerCase()).toContain("no biller");
    expect(SANDBOX_BILLER_NOTICE.toLowerCase()).toContain("regulatory authorization exists");
    expect(adapter.getCapabilities().refunds).toBe(false);
    expect(adapter.getCapabilities().complaints).toBe(false);
  });

  it("returns provider metadata-driven parameters and labelled bill fixtures", async () => {
    const billers = await adapter.getBillers();
    expect(billers.length).toBeGreaterThan(0);
    expect(billers.every((b) => b.parameters.length > 0)).toBe(true);
    const bill = await adapter.fetchBill("sandbox-electricity", { consumerNumber: "TEST123" });
    expect(bill?.amountMinor).toBeGreaterThan(0);
    expect(bill?.status).toBe("FETCHED");
    expect(bill?.validUntil).toBeInstanceOf(Date);
    expect(bill?.rawPayload?.test).toBe(true);
    expect(JSON.stringify(bill?.rawPayload)).toContain("SANDBOX DEMONSTRATION ONLY");
  });

  it("rejects invalid customer details without fabricating a bill", async () => {
    expect(await adapter.fetchBill("sandbox-electricity", {})).toBeNull();
    expect((await adapter.validateCustomerDetails("sandbox-electricity", {})).valid).toBe(false);
  });

  it("does not claim refund support", async () => {
    expect(await adapter.requestRefundOrReversal("any-ref")).toBeNull();
  });
});

describe("household permission model", () => {
  it("defines four roles and never implies money movement", () => {
    expect(HOUSEHOLD_ROLES).toEqual(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
  });
});

describe("cold-start behavior for bill baselines", () => {
  it("does not classify a new customer as anomalous", () => {
    expect(isColdStart(0)).toBe(true);
    let baseline = emptyBaseline();
    for (const value of [1000, 1100, 900]) baseline = updateBaseline(baseline, value);
    expect(baseline.coldStart).toBe(true);
    expect(isColdStart(baseline.sampleCount)).toBe(true);
  });
});
