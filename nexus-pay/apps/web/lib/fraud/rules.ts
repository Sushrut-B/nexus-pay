/** Release 13 — deterministic, versioned, testable fraud rules. No ML black boxes. */

import { prisma, type FraudRule, type FraudRuleCategory, type FraudRuleSeverity } from "@nexus/database";
import type { RiskAction } from "@nexus/shared-types";
import { RULESET_VERSION } from "@/lib/fraud/config";

export interface RiskContext {
  actorId?: string;
  subjectId?: string;
  sourceModule?: string;
  subjectType?: string;
  amountMinor?: number;
  currency?: string;
  recipientCount?: number;
  velocityCount?: number;
  failedLoginCount?: number;
  passwordResetCount?: number;
  mfaFailureCount?: number;
  recoveryRecent?: boolean;
  newDevice?: boolean;
  failedPaymentCount?: number;
  unusualHour?: boolean;
  similarPaymentCount?: number;
  merchantVolumeDeviation?: number;
  refundCount?: number;
  webhookConfigChanged?: boolean;
  referralCount?: number;
  redemptionCount?: number;
  sharedDeviceCount?: number;
  applicationCount?: number;
  documentFailureCount?: number;
  providerFailureCount?: number;
  duplicateApplication?: boolean;
  dormantReactivation?: boolean;
  baseline?: { mean: number; mdev: number; sampleCount: number; coldStart: boolean };
  eventTypes?: string[];
}

export interface RuleOutcome {
  matched: boolean;
  evidence?: string;
  value?: number;
}

export interface RuleDefinition {
  code: string;
  name: string;
  description: string;
  category: FraudRuleCategory;
  severity: FraudRuleSeverity;
  defaultContribution: number;
  defaultWindowSeconds: number;
  defaultThresholds: Record<string, number>;
  recommendedAction: RiskAction;
  evaluate: (ctx: RiskContext, thresholds: Record<string, number>) => RuleOutcome;
}

function atLeast(value: number | undefined, key: string, thresholds: Record<string, number>, fallback: number): RuleOutcome {
  const limit = thresholds[key] ?? fallback;
  const actual = value ?? 0;
  return { matched: actual >= limit, value: actual, evidence: `${actual} >= ${limit} within window` };
}

export const BUILTIN_RULES: RuleDefinition[] = [
  // Authentication
  { code: "AUTH_FAILED_LOGIN_VELOCITY", name: "Failed login velocity", description: "Several failed sign-in attempts in a short window.", category: "AUTHENTICATION", severity: "HIGH", defaultContribution: 18, defaultWindowSeconds: 300, defaultThresholds: { count: 5 }, recommendedAction: "REQUIRE_STEP_UP_AUTHENTICATION", evaluate: (c, t) => atLeast(c.failedLoginCount, "count", t, 5) },
  { code: "AUTH_PASSWORD_RESET_VELOCITY", name: "Password reset velocity", description: "Repeated password reset requests in a short window.", category: "AUTHENTICATION", severity: "HIGH", defaultContribution: 16, defaultWindowSeconds: 3600, defaultThresholds: { count: 3 }, recommendedAction: "REQUIRE_STEP_UP_AUTHENTICATION", evaluate: (c, t) => atLeast(c.passwordResetCount, "count", t, 3) },
  { code: "AUTH_NEW_DEVICE_LOGIN", name: "New device sign-in", description: "Sign-in from a device not previously associated with the account.", category: "AUTHENTICATION", severity: "MEDIUM", defaultContribution: 8, defaultWindowSeconds: 86400, defaultThresholds: {}, recommendedAction: "ALLOW_WITH_MONITORING", evaluate: (c) => ({ matched: c.newDevice === true, evidence: "Device not previously observed" }) },
  { code: "AUTH_MFA_FAILURE_VELOCITY", name: "MFA failure velocity", description: "Repeated MFA failures where MFA exists. Never emitted while MFA is unavailable.", category: "AUTHENTICATION", severity: "HIGH", defaultContribution: 20, defaultWindowSeconds: 300, defaultThresholds: { count: 3 }, recommendedAction: "REQUIRE_STEP_UP_AUTHENTICATION", evaluate: (c, t) => atLeast(c.mfaFailureCount, "count", t, 3) },
  { code: "AUTH_RECOVERY_THEN_SENSITIVE", name: "Recovery followed by sensitive action", description: "Sensitive activity shortly after account recovery.", category: "AUTHENTICATION", severity: "CRITICAL", defaultContribution: 24, defaultWindowSeconds: 3600, defaultThresholds: {}, recommendedAction: "REQUIRE_STEP_UP_AUTHENTICATION", evaluate: (c) => ({ matched: c.recoveryRecent === true && (c.eventTypes ?? []).some((type) => type.includes("CHANGED") || type === "PAYMENT_INITIATED"), evidence: "Recent recovery followed by sensitive activity" }) },
  // Payment
  { code: "PAYMENT_HIGH_AMOUNT_DEVIATION", name: "Unusual payment amount", description: "Amount far above the customer's established baseline. Cold-start users are excluded.", category: "PAYMENT", severity: "HIGH", defaultContribution: 20, defaultWindowSeconds: 86400, defaultThresholds: { sigma: 3 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => {
    const b = c.baseline;
    if (!b || b.coldStart || b.sampleCount < 5 || c.amountMinor === undefined) return { matched: false, evidence: "Insufficient historical evidence" };
    const sigma = t.sigma ?? 3;
    const limit = b.mean + sigma * Math.max(b.mdev, 1);
    return { matched: c.amountMinor > limit, value: c.amountMinor, evidence: `Amount exceeds baseline by ${sigma} MAD units` };
  } },
  { code: "PAYMENT_RAPID_TRANSFERS", name: "Rapid successive transfers", description: "Several payments initiated in a short window.", category: "PAYMENT", severity: "MEDIUM", defaultContribution: 14, defaultWindowSeconds: 300, defaultThresholds: { count: 4 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => atLeast(c.velocityCount, "count", t, 4) },
  { code: "PAYMENT_MULTIPLE_RECIPIENTS", name: "Multiple recipients", description: "Many distinct recipients in a short window.", category: "PAYMENT", severity: "MEDIUM", defaultContribution: 12, defaultWindowSeconds: 900, defaultThresholds: { count: 5 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => atLeast(c.recipientCount, "count", t, 5) },
  { code: "PAYMENT_FAILED_ATTEMPTS", name: "Repeated failed payments", description: "Several rejected payment attempts in a short window.", category: "PAYMENT", severity: "MEDIUM", defaultContribution: 12, defaultWindowSeconds: 600, defaultThresholds: { count: 3 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => atLeast(c.failedPaymentCount, "count", t, 3) },
  { code: "PAYMENT_UNUSUAL_HOUR", name: "Unusual transaction timing", description: "Payment initiated outside the customer's typical hours.", category: "PAYMENT", severity: "LOW", defaultContribution: 5, defaultWindowSeconds: 86400, defaultThresholds: {}, recommendedAction: "ALLOW_WITH_MONITORING", evaluate: (c) => ({ matched: c.unusualHour === true, evidence: "Outside typical activity window" }) },
  { code: "PAYMENT_POST_RECOVERY", name: "Payment after account recovery", description: "Payment initiated shortly after account recovery.", category: "PAYMENT", severity: "CRITICAL", defaultContribution: 26, defaultWindowSeconds: 3600, defaultThresholds: {}, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c) => ({ matched: c.recoveryRecent === true && c.sourceModule === "payments", evidence: "Recovery event immediately preceded payment" }) },
  { code: "PAYMENT_SIMILAR_PATTERN", name: "Repeated similar payments", description: "Several payments with suspiciously similar characteristics.", category: "PAYMENT", severity: "MEDIUM", defaultContribution: 10, defaultWindowSeconds: 1800, defaultThresholds: { count: 4 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => atLeast(c.similarPaymentCount, "count", t, 4) },
  // Merchant
  { code: "MERCHANT_VOLUME_SPIKE", name: "Merchant volume spike", description: "Checkout volume far above the merchant baseline.", category: "MERCHANT", severity: "HIGH", defaultContribution: 16, defaultWindowSeconds: 3600, defaultThresholds: { ratio: 3 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => {
    const actual = c.merchantVolumeDeviation ?? 0;
    const limit = t.ratio ?? 3;
    return { matched: actual >= limit, value: actual, evidence: `${actual.toFixed(1)}x baseline` };
  } },
  { code: "MERCHANT_REFUND_PATTERN", name: "Abnormal refund pattern", description: "Unusually frequent refund requests.", category: "MERCHANT", severity: "MEDIUM", defaultContribution: 12, defaultWindowSeconds: 86400, defaultThresholds: { count: 5 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.refundCount, "count", t, 5) },
  { code: "MERCHANT_WEBHOOK_CONFIG_CHANGE", name: "Webhook configuration change", description: "Merchant webhook endpoint or secret changed recently.", category: "MERCHANT", severity: "HIGH", defaultContribution: 15, defaultWindowSeconds: 3600, defaultThresholds: {}, recommendedAction: "REQUIRE_STEP_UP_AUTHENTICATION", evaluate: (c) => ({ matched: c.webhookConfigChanged === true, evidence: "Webhook configuration changed" }) },
  // Rewards & referrals
  { code: "REWARDS_REFERRAL_VELOCITY", name: "Referral velocity", description: "Many referrals created in a short window.", category: "REWARDS", severity: "MEDIUM", defaultContribution: 12, defaultWindowSeconds: 86400, defaultThresholds: { count: 6 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.referralCount, "count", t, 6) },
  { code: "REWARDS_REDEMPTION_VELOCITY", name: "Redemption velocity", description: "Unusually fast reward redemption.", category: "REWARDS", severity: "MEDIUM", defaultContribution: 10, defaultWindowSeconds: 3600, defaultThresholds: { count: 5 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.redemptionCount, "count", t, 5) },
  { code: "REWARDS_SHARED_DEVICE_REFERRALS", name: "Shared technical indicators", description: "Several referral accounts sharing a device. A signal only, never proof of fraud.", category: "REWARDS", severity: "MEDIUM", defaultContribution: 8, defaultWindowSeconds: 86400, defaultThresholds: { count: 3 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.sharedDeviceCount, "count", t, 3) },
  // Applications & documents
  { code: "APP_DOCUMENT_FAILURE_VELOCITY", name: "Document upload failures", description: "Repeated failed document submissions.", category: "APPLICATION", severity: "MEDIUM", defaultContribution: 10, defaultWindowSeconds: 1800, defaultThresholds: { count: 4 }, recommendedAction: "REQUIRE_CUSTOMER_CONFIRMATION", evaluate: (c, t) => atLeast(c.documentFailureCount, "count", t, 4) },
  { code: "APP_APPLICATION_VELOCITY", name: "Application velocity", description: "Many credit or insurance applications in a short window.", category: "APPLICATION", severity: "MEDIUM", defaultContribution: 12, defaultWindowSeconds: 3600, defaultThresholds: { count: 5 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.applicationCount, "count", t, 5) },
  { code: "APP_PROVIDER_FAILURE_VELOCITY", name: "Provider submission failures", description: "Repeated provider submission failures.", category: "APPLICATION", severity: "MEDIUM", defaultContribution: 10, defaultWindowSeconds: 1800, defaultThresholds: { count: 3 }, recommendedAction: "HOLD_FOR_MANUAL_REVIEW", evaluate: (c, t) => atLeast(c.providerFailureCount, "count", t, 3) },
  { code: "APP_DUPLICATE_APPLICATION", name: "Duplicate application attempt", description: "A duplicate application was detected.", category: "APPLICATION", severity: "LOW", defaultContribution: 6, defaultWindowSeconds: 3600, defaultThresholds: {}, recommendedAction: "ALLOW_WITH_MONITORING", evaluate: (c) => ({ matched: c.duplicateApplication === true, evidence: "Duplicate application signature" }) },
  // Behavioral / operational
  { code: "BEH_DORMANT_REACTIVATION", name: "Dormant account reactivation", description: "Activity after a long dormant period.", category: "BEHAVIORAL", severity: "MEDIUM", defaultContribution: 8, defaultWindowSeconds: 86400, defaultThresholds: {}, recommendedAction: "ALLOW_WITH_MONITORING", evaluate: (c) => ({ matched: c.dormantReactivation === true, evidence: "Account dormant before recent activity" }) },
];

export function findRule(code: string): RuleDefinition | undefined {
  return BUILTIN_RULES.find((rule) => rule.code === code);
}

export function evaluateRule(definition: RuleDefinition, ctx: RiskContext, overrides?: Record<string, number>): RuleOutcome & { contribution: number } {
  const thresholds = { ...definition.defaultThresholds, ...(overrides ?? {}) };
  const outcome = definition.evaluate(ctx, thresholds);
  return { ...outcome, contribution: outcome.matched ? definition.defaultContribution : 0 };
}

/** Seeds configurable rule rows without overwriting administrator edits. */
export async function seedRules(actorId = "system"): Promise<number> {
  let created = 0;
  for (const rule of BUILTIN_RULES) {
    const existing = await prisma.fraudRule.findUnique({ where: { code: rule.code } });
    if (existing) continue;
    await prisma.fraudRule.create({
      data: {
        code: rule.code,
        name: rule.name,
        description: rule.description,
        category: rule.category,
        severity: rule.severity,
        conditions: { engine: RULESET_VERSION },
        thresholds: rule.defaultThresholds,
        windowSeconds: rule.defaultWindowSeconds,
        enabled: true,
        version: 1,
        riskContribution: rule.defaultContribution,
        recommendedAction: rule.recommendedAction,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    created += 1;
  }
  return created;
}

export function ruleRowsToContext(rows: FraudRule[]): Array<{ row: FraudRule; definition: RuleDefinition | undefined }> {
  return rows.map((row) => ({ row, definition: findRule(row.code) }));
}
