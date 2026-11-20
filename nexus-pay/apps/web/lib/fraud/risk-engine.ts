import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, type RiskAction as RiskActionEnum, type RiskClassification as RiskClassificationEnum } from "@nexus/database";
import type { RiskEvaluationView, RiskSignalView, RiskClassification, RiskAction } from "@nexus/shared-types";
import { getServerEnv } from "@/lib/env";
import {
  DEFAULT_ACTION_MAP, DEFAULT_POLICY_CODE, DEFAULT_THRESHOLDS, FEATURE_VERSION,
  MODEL_VERSION, RULESET_VERSION, sanitizeMetadata,
} from "@/lib/fraud/config";
import { BUILTIN_RULES, evaluateRule, type RiskContext } from "@/lib/fraud/rules";
import { securityAudit } from "@/lib/fraud/audit-service";

export interface EvaluateInput {
  mode: "SYNC_PRE_TRANSACTION" | "ASYNC_POST_TRANSACTION" | "PERIODIC" | "MANUAL";
  subjectType: "USER" | "PAYMENT" | "MERCHANT" | "APPLICATION" | "SESSION" | "DEVICE";
  subjectId: string;
  userId?: string;
  context: RiskContext;
  ipAddress?: string | null;
  requestId?: string;
  forceFallback?: boolean;
}

export interface Thresholds { lowMax: number; moderateMax: number; highMax: number }

export function classifyScore(score: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): RiskClassification {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  if (value <= thresholds.lowMax) return "LOW";
  if (value <= thresholds.moderateMax) return "MODERATE";
  if (value <= thresholds.highMax) return "HIGH";
  return "CRITICAL";
}

export function selectAction(classification: RiskClassification, actionMap: Record<string, string> = {}): RiskAction {
  const mapped = actionMap[classification];
  const allowed: RiskAction[] = ["ALLOW", "ALLOW_WITH_MONITORING", "REQUIRE_STEP_UP_AUTHENTICATION", "REQUIRE_CUSTOMER_CONFIRMATION", "HOLD_FOR_MANUAL_REVIEW", "BLOCK_INITIATION"];
  return allowed.includes(mapped as RiskAction) ? (mapped as RiskAction) : DEFAULT_ACTION_MAP[classification];
}

export function evaluationView(row: {
  id: string; reference: string; mode: string; subjectType: string; subjectId: string;
  score: number; classification: string; action: string; triggeredRules: unknown;
  signals: unknown; explanation: string | null; evidenceQuality: string;
  rulesetVersion: string; policyVersion: string; modelVersion: string | null; createdAt: Date;
}): RiskEvaluationView {
  return {
    id: row.id, reference: row.reference, mode: row.mode, subjectType: row.subjectType,
    subjectId: row.subjectId, score: row.score,
    classification: row.classification as RiskClassification,
    action: row.action as RiskAction,
    triggeredRules: (row.triggeredRules as Array<{ code: string; name: string; contribution: number }>) ?? [],
    signals: (row.signals as RiskSignalView[]) ?? [],
    explanation: row.explanation,
    evidenceQuality: row.evidenceQuality,
    rulesetVersion: row.rulesetVersion,
    policyVersion: row.policyVersion,
    modelVersion: row.modelVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Pure computation used by the engine and by unit tests. */
export function computeEvaluation(input: {
  context: RiskContext;
  rules: Array<{ code: string; name: string; contribution: number; enabled: boolean; thresholds: Record<string, number> }>;
  thresholds: Thresholds;
  actionMap: Record<string, string>;
}) {
  const triggered: Array<{ code: string; name: string; contribution: number; evidence?: string }> = [];
  const signals: RiskSignalView[] = [];
  for (const rule of input.rules) {
    const definition = BUILTIN_RULES.find((candidate) => candidate.code === rule.code);
    if (!definition || !rule.enabled) continue;
    const outcome = evaluateRule(definition, input.context, rule.thresholds);
    if (!outcome.matched) continue;
    const contribution = Math.min(100, rule.contribution);
    triggered.push({ code: rule.code, name: rule.name, contribution, evidence: outcome.evidence });
    signals.push({
      name: rule.code,
      value: outcome.value !== undefined ? String(outcome.value) : null,
      weight: contribution,
      source: "RULE",
      evidence: outcome.evidence ?? null,
    });
  }
  const score = Math.max(0, Math.min(100, triggered.reduce((sum, rule) => sum + rule.contribution, 0)));
  const classification = classifyScore(score, input.thresholds);
  const action = selectAction(classification, input.actionMap);
  return { score, classification, action, triggered, signals };
}

function fallbackEvaluation(input: EvaluateInput): RiskEvaluationView {
  const action = (getServerEnv().NEXUS_FRAUD_FALLBACK_ACTION ?? "REQUIRE_CUSTOMER_CONFIRMATION") as RiskAction;
  return {
    id: `fallback_${randomUUID()}`,
    reference: `risk_fallback_${randomUUID()}`,
    mode: input.mode,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    score: 0,
    classification: "LOW",
    action,
    triggeredRules: [],
    signals: [{ name: "ENGINE_UNAVAILABLE", value: null, weight: 0, source: "SYSTEM", evidence: "Configured fallback applied" }],
    explanation: "The risk engine was unavailable. The configured fallback policy was applied and audited. No security check was silently bypassed.",
    evidenceQuality: "NONE",
    rulesetVersion: RULESET_VERSION,
    policyVersion: "fallback",
    modelVersion: null,
    createdAt: new Date().toISOString(),
  };
}

/** Full evaluation with durable record, signals, features and alerting. */
export async function evaluateRisk(input: EvaluateInput): Promise<RiskEvaluationView> {
  if (input.forceFallback || !getServerEnv().NEXUS_FRAUD_ENGINE_ENABLED) {
    await securityAudit({
      actorType: "SYSTEM", actorId: "risk-engine", action: "RISK_ENGINE_FALLBACK",
      targetType: input.subjectType, targetId: input.subjectId,
      metadata: { mode: input.mode, reason: "engine disabled or forced" },
    });
    return fallbackEvaluation(input);
  }
  try {
    const [rules, policy] = await Promise.all([
      prisma.fraudRule.findMany({ where: { enabled: true } }),
      prisma.riskPolicy.findUnique({ where: { code: DEFAULT_POLICY_CODE } }),
    ]);
    const thresholds: Thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...((policy?.thresholds as object | null) ?? {}),
    } as Thresholds;
    const actionMap = (policy?.actionMap as Record<string, string> | null) ?? {};
    const computed = computeEvaluation({
      context: input.context,
      rules: rules.map((rule) => ({
        code: rule.code, name: rule.name, contribution: rule.riskContribution,
        enabled: rule.enabled, thresholds: (rule.thresholds as Record<string, number>) ?? {},
      })),
      thresholds,
      actionMap,
    });

    const reference = `risk_${randomUUID()}`;
    const evidenceQuality = input.context.baseline?.coldStart ? "LIMITED" : "MODERATE";
    const row = await prisma.riskEvaluation.create({
      data: {
        reference,
        mode: input.mode,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        userId: input.userId ?? null,
        score: computed.score,
        classification: computed.classification as RiskClassificationEnum,
        action: computed.action as RiskActionEnum,
        triggeredRules: computed.triggered as unknown as Prisma.InputJsonValue,
        signals: computed.signals as unknown as Prisma.InputJsonValue,
        explanation: computed.triggered.length
          ? `Score derived from ${computed.triggered.length} rule(s): ${computed.triggered.map((rule) => rule.code).join(", ")}.`
          : "No configured rule matched the available signals. This is an indicator, not proof of fraud.",
        evidenceQuality,
        rulesetVersion: RULESET_VERSION,
        policyVersion: policy ? `v${policy.version}` : "default-v1",
        modelVersion: MODEL_VERSION,
      },
    });
    await prisma.fraudRiskSignal.createMany({
      data: computed.signals.map((signal) => ({
        evaluationId: row.id,
        name: signal.name,
        value: signal.value,
        weight: signal.weight,
        source: signal.source,
        evidence: signal.evidence,
      })),
    });
    await prisma.riskFeatureSnapshot.create({
      data: {
        evaluationId: row.id,
        featureVersion: FEATURE_VERSION,
        features: sanitizeMetadata(input.context) as Prisma.InputJsonValue,
        provenance: { sourceModules: input.context.eventTypes ?? [], ipHashed: Boolean(input.ipAddress) } as Prisma.InputJsonValue,
      },
    });
    if (computed.classification === "HIGH" || computed.classification === "CRITICAL") {
      await prisma.riskAlert.create({
        data: {
          reference: `alert_${randomUUID()}`,
          userId: input.userId ?? null,
          evaluationId: row.id,
          score: computed.score,
          severity: computed.classification === "CRITICAL" ? "CRITICAL" : "HIGH",
          status: "NEW",
          title: `Elevated ${input.subjectType.toLowerCase()} risk`,
          summary: computed.triggered.map((rule) => rule.name).join("; ").slice(0, 500) || "Elevated risk score",
          triggeredRules: computed.triggered.map((rule) => rule.code) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return evaluationView(row);
  } catch (error) {
    await securityAudit({
      actorType: "SYSTEM", actorId: "risk-engine", action: "RISK_ENGINE_FAILURE_FALLBACK",
      targetType: input.subjectType, targetId: input.subjectId,
      metadata: { error: error instanceof Error ? error.message.slice(0, 300) : "engine failure" },
    });
    return fallbackEvaluation(input);
  }
}

export async function listEvaluations(subjectId?: string, limit = 50) {
  const rows = await prisma.riskEvaluation.findMany({
    where: subjectId ? { subjectId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(evaluationView);
}

export async function getEvaluation(reference: string): Promise<RiskEvaluationView | null> {
  const row = await prisma.riskEvaluation.findFirst({ where: { OR: [{ id: reference }, { reference }] } });
  return row ? evaluationView(row) : null;
}
