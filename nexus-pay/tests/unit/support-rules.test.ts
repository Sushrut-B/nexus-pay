import { describe, expect, it } from "vitest";
import {
  CASE_TRANSITIONS, CATEGORY_OPTIONS, ESCALATION_SIGNALS, SUPPORT_NOTICE,
  categoryOption, defaultNextAction, isSensitiveText, linkTypeForCategory,
} from "../../apps/web/lib/support/support-constants";

describe("Release 19 — support case rules", () => {
  it("covers categories only for implemented modules", () => {
    expect(CATEGORY_OPTIONS.length).toBeGreaterThanOrEqual(15);
    expect(CATEGORY_OPTIONS.map((c) => c.category)).toContain("INTERNATIONAL_PAYMENT_ISSUE");
    expect(CATEGORY_OPTIONS.map((c) => c.category)).toContain("TAX_DOCUMENT_ISSUE");
    expect(CATEGORY_OPTIONS.map((c) => c.category)).not.toContain("CRYPTO_ISSUE");
  });

  it("maps payment categories to the correct link type", () => {
    expect(linkTypeForCategory("PAYMENT_WRONG_RECIPIENT")).toBe("P2P_PAYMENT");
    expect(linkTypeForCategory("TRAVEL_BOOKING_ISSUE")).toBe("TRAVEL_BOOKING");
    expect(linkTypeForCategory("OTHER")).toBe("GENERAL");
    expect(categoryOption("MERCHANT_ORDER_ISSUE").label).toBeTruthy();
  });

  it("enforces a finite, documented status machine", () => {
    expect(CASE_TRANSITIONS.OPEN).toContain("TRIAGED");
    expect(CASE_TRANSITIONS.RESOLVED).toContain("REOPENED");
    expect(CASE_TRANSITIONS.CLOSED).toContain("REOPENED");
    expect(CASE_TRANSITIONS.RESOLVED).not.toContain("OPEN");
    expect(Object.keys(CASE_TRANSITIONS).length).toBe(10);
  });

  it("defines customer-visible next steps", () => {
    expect(defaultNextAction("WAITING_FOR_USER")).toContain("Provide");
    expect(defaultNextAction("RESOLUTION_PROPOSED")).toContain("Review");
    expect(defaultNextAction("IN_PROGRESS")).toBeNull();
  });

  it("flags credentials in submitted content without storing them in the timeline", () => {
    expect(isSensitiveText("my password is abc")).toBe(true);
    expect(isSensitiveText("UPI PIN 1234")).toBe(true);
    expect(isSensitiveText("the OTP was 998877")).toBe(true);
    expect(isSensitiveText("payment did not arrive")).toBe(false);
  });

  it("uses only documented escalation signals", () => {
    expect(ESCALATION_SIGNALS.has("UNAUTHORIZED_ACTIVITY")).toBe(true);
    expect(ESCALATION_SIGNALS.has("RANDOM_AI_GUESS")).toBe(false);
  });

  it("never implies a resolution promise", () => {
    expect(SUPPORT_NOTICE).toContain("does not change");
    expect(SUPPORT_NOTICE).toContain("never claim");
  });
});
