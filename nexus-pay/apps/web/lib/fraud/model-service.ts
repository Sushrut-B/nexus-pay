/** Release 13 — ML governance foundation. All models are advisory; none claim measured production accuracy. */

import { prisma } from "@nexus/database";
import { FEATURE_VERSION, MODEL_VERSION } from "@/lib/fraud/config";
import { securityAudit } from "@/lib/fraud/audit-service";

export interface ModelPrediction {
  advisoryScore: number;
  explanation: string;
  modelVersion: string;
  advisoryOnly: true;
}

/** Extension point for future ML models. The baseline delegates to the explainable rules engine output. */
export interface FraudModelAdapter {
  readonly version: string;
  predict(input: { score: number; signals: Array<{ name: string; weight: number }> }): ModelPrediction;
}

export const rulesBaselineModel: FraudModelAdapter = {
  version: MODEL_VERSION,
  predict(input) {
    return {
      advisoryScore: Math.max(0, Math.min(100, Math.round(input.score))),
      explanation: `Rules-baseline advisory score from ${input.signals.length} signal(s). No trained model is deployed.`,
      modelVersion: MODEL_VERSION,
      advisoryOnly: true,
    };
  },
};

export function selectModel(adapters: FraudModelAdapter[], preferredVersion?: string): FraudModelAdapter {
  return adapters.find((adapter) => adapter.version === preferredVersion) ?? adapters[0] ?? rulesBaselineModel;
}

/** Registers the transparent baseline as the initial advisory model version. */
export async function ensureBaselineModel(actorId = "system") {
  const existing = await prisma.fraudModelVersion.findUnique({ where: { version: MODEL_VERSION } });
  if (existing) return existing;
  const row = await prisma.fraudModelVersion.create({
    data: {
      version: MODEL_VERSION,
      owner: "Nexus Pay Security Engineering",
      datasetRef: "NONE — deterministic rules baseline, no training data",
      featureVersion: FEATURE_VERSION,
      evaluationSummary: {
        advisoryOnly: true,
        claim: "No production-grade detection accuracy is claimed. Rules are deterministic and explainable.",
      },
      status: "ACTIVE",
      advisoryOnly: true,
      deployedAt: new Date(),
    },
  });
  await securityAudit({
    actorType: "SYSTEM", actorId, action: "FRAUD_MODEL_DEPLOYED",
    targetType: "fraud_model_version", targetId: row.id,
    metadata: { version: MODEL_VERSION, advisoryOnly: true },
  });
  return row;
}

export async function listModels() {
  return prisma.fraudModelVersion.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
}

export async function listModelEvaluations(modelId?: string) {
  return prisma.fraudModelEvaluation.findMany({
    where: modelId ? { modelId } : undefined,
    orderBy: { evaluatedAt: "desc" }, take: 100,
  });
}
