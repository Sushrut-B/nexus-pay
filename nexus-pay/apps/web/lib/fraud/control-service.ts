import { prisma } from "@nexus/database";
import type { FraudOperationsView } from "@nexus/shared-types";
import { getServerEnv } from "@/lib/env";
import { BUILTIN_RULES } from "@/lib/fraud/rules";

const DAY = 86_400_000;

function countBy<T extends string>(rows: Array<{ status: T }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
}

export async function getFraudOperations(): Promise<FraudOperationsView> {
  const since = new Date(Date.now() - DAY);
  const [
    events24h, evaluations24h, alerts, cases, authFailures, suspiciousPayments,
    rulesEnabled, evaluations, backlog, activeModel,
  ] = await Promise.all([
    prisma.securityEvent.count({ where: { occurredAt: { gte: since } } }),
    prisma.riskEvaluation.count({ where: { createdAt: { gte: since } } }),
    prisma.riskAlert.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.fraudCase.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.securityEvent.count({ where: { type: "LOGIN_FAILURE", occurredAt: { gte: since } } }),
    prisma.securityEvent.count({ where: { type: "PAYMENT_UNKNOWN", occurredAt: { gte: since } } }),
    prisma.fraudRule.count({ where: { enabled: true } }),
    prisma.riskEvaluation.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
    prisma.securityEventOutbox.count({ where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] } } }),
    prisma.fraudModelVersion.findFirst({ where: { status: "ACTIVE" }, orderBy: { deployedAt: "desc" } }),
  ]);
  const riskByClassification = evaluations.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const ruleTriggers = BUILTIN_RULES.map((rule) => ({
    code: rule.code,
    count: evaluations.filter((evaluation) => {
      const triggered = evaluation.triggeredRules as Array<{ code: string }>;
      return Array.isArray(triggered) && triggered.some((item) => item.code === rule.code);
    }).length,
  })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 10);

  return {
    events24h,
    evaluations24h,
    highRiskAlerts: alerts.filter((alert) => alert.severity === "HIGH" || alert.severity === "CRITICAL").length,
    openCases: cases.filter((item) => !["RESOLVED", "FALSE_POSITIVE", "CLOSED"].includes(item.status)).length,
    authFailures24h: authFailures,
    suspiciousPayments24h: suspiciousPayments,
    confirmedFraud: 0,
    rulesEnabled: rulesEnabled,
    fallbackAction: getServerEnv().NEXUS_FRAUD_FALLBACK_ACTION,
    notice: "Risk scores are indicators, not proof of fraud. No confirmed fraud count is shown without verified cases.",
    currency: "INR",
    riskByClassification,
    alertsByStatus: countBy(alerts),
    casesByStatus: countBy(cases),
    ruleTriggers,
    activeModelVersion: activeModel?.version ?? null,
    eventBacklog: backlog,
  };
}

export async function listRules() {
  return prisma.fraudRule.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] });
}

export async function listPolicies() {
  return prisma.riskPolicy.findMany({ orderBy: { code: "asc" } });
}

export async function listFraudCases(limit = 100) {
  return prisma.fraudCase.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
