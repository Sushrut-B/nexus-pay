import type { Prisma } from "@prisma/client";
import { prisma } from "@nexus/database";
import type { FraudRuleInput, FraudRuleUpdateInput, RiskPolicyInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { securityAudit } from "@/lib/fraud/audit-service";

export async function createRule(input: FraudRuleInput, actorId: string) {
  const existing = await prisma.fraudRule.findUnique({ where: { code: input.code } });
  if (existing) throw new ApiError(409, "PAYMENT_ERROR", "A rule with that code already exists.");
  const row = await prisma.fraudRule.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      category: input.category,
      severity: input.severity,
      conditions: { engine: "r13-rules-v1" },
      thresholds: input.thresholds as Prisma.InputJsonValue,
      windowSeconds: input.windowSeconds,
      enabled: input.enabled,
      version: 1,
      riskContribution: input.riskContribution,
      recommendedAction: input.recommendedAction as never,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
  await prisma.fraudRuleVersion.create({
    data: { ruleId: row.id, version: 1, snapshot: { ...input } as Prisma.InputJsonValue, createdBy: actorId },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_RULE_CREATED",
    targetType: "fraud_rule", targetId: row.id, metadata: { code: row.code, version: 1 },
  });
  return row;
}

export async function updateRule(id: string, input: FraudRuleUpdateInput, actorId: string, justification?: string) {
  const existing = await prisma.fraudRule.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "PAYMENT_ERROR", "Fraud rule not found.");
  const version = existing.version + 1;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.fraudRule.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.category ? { category: input.category as never } : {}),
        ...(input.severity ? { severity: input.severity as never } : {}),
        ...(input.thresholds ? { thresholds: input.thresholds as Prisma.InputJsonValue } : {}),
        ...(input.windowSeconds ? { windowSeconds: input.windowSeconds } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.riskContribution !== undefined ? { riskContribution: input.riskContribution } : {}),
        ...(input.recommendedAction ? { recommendedAction: input.recommendedAction as never } : {}),
        version,
        updatedBy: actorId,
      },
    });
    await tx.fraudRuleVersion.create({
      data: { ruleId: id, version, snapshot: { ...existing, ...input } as Prisma.InputJsonValue, createdBy: actorId },
    });
    return updated;
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_RULE_UPDATED",
    targetType: "fraud_rule", targetId: id, justification,
    metadata: { code: row.code, fromVersion: existing.version, toVersion: version },
  });
  return row;
}

export async function setRuleEnabled(id: string, enabled: boolean, actorId: string, justification?: string) {
  return updateRule(id, { enabled }, actorId, justification);
}

export async function updatePolicy(id: string, input: RiskPolicyInput, actorId: string, justification?: string) {
  const existing = await prisma.riskPolicy.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "PAYMENT_ERROR", "Risk policy not found.");
  const row = await prisma.riskPolicy.update({
    where: { id },
    data: {
      thresholds: input.thresholds as Prisma.InputJsonValue,
      actionMap: input.actionMap as Prisma.InputJsonValue,
      fallbackAction: input.fallbackAction as never,
      version: { increment: 1 },
      updatedBy: actorId,
    },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "RISK_POLICY_UPDATED",
    targetType: "risk_policy", targetId: id, justification,
    metadata: { version: row.version },
  });
  return row;
}

export async function listRuleVersions(ruleId: string) {
  return prisma.fraudRuleVersion.findMany({ where: { ruleId }, orderBy: { version: "desc" } });
}
