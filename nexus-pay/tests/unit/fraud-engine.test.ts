import { describe, expect, it } from "vitest";
import {
  classifyScore, computeEvaluation, selectAction,
} from "../../apps/web/lib/fraud/risk-engine";
import { BUILTIN_RULES, evaluateRule, findRule } from "../../apps/web/lib/fraud/rules";
import {
  anomalyScore, emptyBaseline, isColdStart, medianAbsoluteDeviation, updateBaseline,
} from "../../apps/web/lib/fraud/behavioral";
import { CASE_TRANSITIONS } from "../../apps/web/lib/fraud/case-service";
import { REPORT_TRANSITIONS } from "../../apps/web/lib/fraud/report-service";
import { sanitizeMetadata } from "../../apps/web/lib/fraud/config";
import { rulesBaselineModel, selectModel } from "../../apps/web/lib/fraud/model-service";
import type { RiskContext } from "../../apps/web/lib/fraud/rules";

const withRule = (ctx: RiskContext) => ({
  rules: BUILTIN_RULES.map((rule) => ({
    code: rule.code, name: rule.name, contribution: rule.defaultContribution,
    enabled: true, thresholds: rule.defaultThresholds,
  })),
  context: ctx,
  thresholds: { lowMax: 24, moderateMax: 49, highMax: 74 },
  actionMap: {},
});

describe("risk score classification", () => {
  it("uses configurable, bounded thresholds", () => {
    expect(classifyScore(0)).toBe("LOW");
    expect(classifyScore(24)).toBe("LOW");
    expect(classifyScore(25)).toBe("MODERATE");
    expect(classifyScore(49)).toBe("MODERATE");
    expect(classifyScore(50)).toBe("HIGH");
    expect(classifyScore(74)).toBe("HIGH");
    expect(classifyScore(75)).toBe("CRITICAL");
    expect(classifyScore(100)).toBe("CRITICAL");
    expect(classifyScore(-10)).toBe("LOW");
    expect(classifyScore(500)).toBe("CRITICAL");
  });

  it("honours custom thresholds", () => {
    expect(classifyScore(30, { lowMax: 10, moderateMax: 20, highMax: 40 })).toBe("HIGH");
  });

  it("maps classifications to explicit actions", () => {
    expect(selectAction("LOW")).toBe("ALLOW");
    expect(selectAction("MODERATE")).toBe("ALLOW_WITH_MONITORING");
    expect(selectAction("HIGH")).toBe("REQUIRE_CUSTOMER_CONFIRMATION");
    expect(selectAction("CRITICAL")).toBe("HOLD_FOR_MANUAL_REVIEW");
    expect(selectAction("HIGH", { HIGH: "BLOCK_INITIATION" })).toBe("BLOCK_INITIATION");
  });
});

describe("deterministic rule evaluation", () => {
  it("detects failed-login velocity at the configured threshold", () => {
    const rule = findRule("AUTH_FAILED_LOGIN_VELOCITY")!;
    expect(evaluateRule(rule, { failedLoginCount: 4 }, {}).matched).toBe(false);
    expect(evaluateRule(rule, { failedLoginCount: 5 }, {}).matched).toBe(true);
    expect(evaluateRule(rule, { failedLoginCount: 3 }, { count: 3 }).matched).toBe(true);
  });

  it("does not flag a cold-start customer for amount deviation", () => {
    const rule = findRule("PAYMENT_HIGH_AMOUNT_DEVIATION")!;
    const cold = evaluateRule(rule, {
      amountMinor: 10_000_000,
      baseline: { mean: 1000, mdev: 10, sampleCount: 2, coldStart: true },
    }, {});
    expect(cold.matched).toBe(false);
    const established = evaluateRule(rule, {
      amountMinor: 10_000_000,
      baseline: { mean: 1000, mdev: 10, sampleCount: 20, coldStart: false },
    }, {});
    expect(established.matched).toBe(true);
  });

  it("flags recovery followed by a payment", () => {
    const rule = findRule("PAYMENT_POST_RECOVERY")!;
    expect(evaluateRule(rule, { recoveryRecent: true, sourceModule: "payments" }, {}).matched).toBe(true);
    expect(evaluateRule(rule, { recoveryRecent: true, sourceModule: "social" }, {}).matched).toBe(false);
  });

  it("never emits MFA rules without MFA signals", () => {
    const result = computeEvaluation(withRule({ failedLoginCount: 5 }));
    expect(result.triggered.map((rule) => rule.code)).not.toContain("AUTH_MFA_FAILURE_VELOCITY");
  });

  it("produces an explainable score bounded at 100", () => {
    const result = computeEvaluation(withRule({
      failedLoginCount: 9, passwordResetCount: 4, newDevice: true,
      recoveryRecent: true, sourceModule: "payments", velocityCount: 8,
      recipientCount: 9, failedPaymentCount: 5, unusualHour: true,
      referralCount: 9, redemptionCount: 9, documentFailureCount: 9,
      applicationCount: 9, providerFailureCount: 9, duplicateApplication: true,
    }));
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.triggered.length).toBeGreaterThan(3);
    expect(result.signals.every((signal) => signal.source === "RULE")).toBe(true);
    expect(result.classification).toBe("CRITICAL");
  });
});

describe("behavioral analytics", () => {
  it("detects cold start and builds a baseline from integer minor units", () => {
    expect(isColdStart(0)).toBe(true);
    expect(isColdStart(4)).toBe(true);
    expect(isColdStart(5)).toBe(false);
    let baseline = emptyBaseline();
    for (const value of [1000, 1100, 900, 1050, 950, 1000, 1020]) {
      baseline = updateBaseline(baseline, value);
    }
    expect(baseline.sampleCount).toBe(7);
    expect(baseline.coldStart).toBe(false);
    expect(baseline.mean).toBeGreaterThan(900);
    expect(baseline.mean).toBeLessThan(1100);
    expect(medianAbsoluteDeviation([1000, 1100, 900, 1050, 950], 1000)).toBeGreaterThanOrEqual(0);
  });

  it("returns zero anomaly score for insufficient evidence", () => {
    expect(anomalyScore(999_999, emptyBaseline())).toBe(0);
    const mature = updateBaseline(updateBaseline(updateBaseline(updateBaseline(updateBaseline(
      emptyBaseline(), 100,
    ), 110), 90), 105), 95);
    expect(anomalyScore(100_000, mature)).toBe(100);
  });
});

describe("event metadata safety", () => {
  it("removes secrets from event metadata", () => {
    const clean = sanitizeMetadata({
      password: "secret", otp: "123456", upin: "1111", accessToken: "abc",
      cardNumber: "4111111111111111", amountMinor: 500, note: "safe",
      nested: { password: "nested-secret", label: "ok" },
    });
    expect(JSON.stringify(clean)).not.toMatch(/secret|123456|1111|4111111111111111|abc/);
    expect(clean.amountMinor).toBe(500);
    expect((clean.nested as Record<string, unknown>).label).toBe("ok");
  });
});

describe("lifecycle transitions", () => {
  it("keeps case resolution terminal", () => {
    expect(CASE_TRANSITIONS.OPEN).toContain("INVESTIGATING");
    expect(CASE_TRANSITIONS.INVESTIGATING).toContain("RESOLVED");
    expect(CASE_TRANSITIONS.RESOLVED).toEqual([]);
    expect(CASE_TRANSITIONS.CLOSED).toEqual([]);
  });

  it("does not treat a fraud report as a reversal", () => {
    expect(REPORT_TRANSITIONS.SUBMITTED).toContain("UNDER_REVIEW");
    expect(REPORT_TRANSITIONS.RESOLVED).toEqual(["CLOSED"]);
    expect(JSON.stringify(REPORT_TRANSITIONS)).not.toContain("REVERSED");
  });
});

describe("model governance", () => {
  it("keeps the baseline advisory and selects a version deterministically", () => {
    const prediction = rulesBaselineModel.predict({ score: 88, signals: [{ name: "RULE", weight: 20 }] });
    expect(prediction.advisoryOnly).toBe(true);
    expect(prediction.advisoryScore).toBe(88);
    expect(prediction.explanation).toContain("No trained model");
    expect(selectModel([rulesBaselineModel]).version).toBe(rulesBaselineModel.version);
  });
});
