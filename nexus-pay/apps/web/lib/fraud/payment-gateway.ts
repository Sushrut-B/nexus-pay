/**
 * Release 13 — read-only payment risk gateway.
 * It evaluates and decides; it never creates a payment intent, never debits a
 * wallet, never changes an idempotency key and never touches the Raftline ledger.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@nexus/database";
import type { RiskAction, RiskEvaluationView } from "@nexus/shared-types";
import { getServerEnv } from "@/lib/env";
import { countRecentEvents, hashIp } from "@/lib/fraud/event-service";
import { getBaseline } from "@/lib/fraud/behavioral";
import { classifyScore, evaluateRisk } from "@/lib/fraud/risk-engine";
import { securityAudit } from "@/lib/fraud/audit-service";

export interface PaymentRiskInput {
  userId: string;
  amountMinor: number;
  recipientId: string;
  clientRequestId?: string;
  sessionId?: string;
  deviceId?: string | null;
  ipAddress?: string | null;
  requestId?: string;
}

export interface PaymentDecision {
  allow: boolean;
  action: RiskAction;
  evaluation: RiskEvaluationView;
  customerMessage?: string;
  assessmentId: string;
}

const BLOCKING_ACTIONS: RiskAction[] = [
  "REQUIRE_STEP_UP_AUTHENTICATION",
  "REQUIRE_CUSTOMER_CONFIRMATION",
  "HOLD_FOR_MANUAL_REVIEW",
  "BLOCK_INITIATION",
];

const MESSAGES: Record<string, string> = {
  REQUIRE_STEP_UP_AUTHENTICATION: "Additional verification is required before this payment can continue.",
  REQUIRE_CUSTOMER_CONFIRMATION: "Please verify this payment before continuing.",
  HOLD_FOR_MANUAL_REVIEW: "This payment is temporarily unavailable for security review. No money has moved.",
  BLOCK_INITIATION: "This payment cannot be initiated at this time. No money has moved.",
};

async function buildContext(input: PaymentRiskInput) {
  const since = new Date(Date.now() - 3600_000);
  const recentSince = new Date(Date.now() - 300_000);
  const [failedLogins, resets, newDevices, paymentsLastHour, paymentsLastFive, baseline] = await Promise.all([
    countRecentEvents({ type: "LOGIN_FAILURE", actorId: input.userId, since }),
    countRecentEvents({ type: "PASSWORD_RESET_COMPLETED", actorId: input.userId, since }),
    countRecentEvents({ type: "NEW_DEVICE_LOGIN", actorId: input.userId, since }),
    countRecentEvents({ type: "PAYMENT_INITIATED", actorId: input.userId, since }),
    countRecentEvents({ type: "PAYMENT_INITIATED", actorId: input.userId, since: recentSince }),
    getBaseline(input.userId, "TRANSACTION_AMOUNT"),
  ]);
  const hour = new Date().getUTCHours();
  return {
    failedLoginCount: failedLogins,
    passwordResetCount: resets,
    newDevice: Boolean(input.deviceId) && newDevices > 0,
    recoveryRecent: resets > 0,
    velocityCount: paymentsLastFive,
    recipientCount: paymentsLastHour,
    similarPaymentCount: paymentsLastHour,
    unusualHour: hour < 5 || hour > 23,
    amountMinor: input.amountMinor,
    sourceModule: "payments",
    subjectType: "PAYMENT" as const,
    baseline: { mean: baseline.mean, mdev: baseline.mdev, sampleCount: baseline.sampleCount, coldStart: baseline.coldStart },
    eventTypes: ["PAYMENT_INITIATED"],
  };
}

/** Evaluates a payment intent BEFORE the existing payment engine is called. */
export async function evaluatePaymentRisk(input: PaymentRiskInput): Promise<PaymentDecision> {
  const context = await buildContext(input);
  const evaluation = await evaluateRisk({
    mode: "SYNC_PRE_TRANSACTION",
    subjectType: "PAYMENT",
    subjectId: input.clientRequestId ?? `payment_${randomUUID()}`,
    userId: input.userId,
    context,
    ipAddress: input.ipAddress,
    requestId: input.requestId,
  });
  const assessment = await prisma.transactionRiskAssessment.create({
    data: {
      clientRequestId: input.clientRequestId ?? null,
      userId: input.userId,
      amountMinor: input.amountMinor,
      evaluationId: evaluation.id,
      action: evaluation.action as never,
      outcome: "PENDING",
      originalIdempotencyKey: input.clientRequestId ?? null,
    },
  });
  const blocking = BLOCKING_ACTIONS.includes(evaluation.action);
  await securityAudit({
    actorType: "SYSTEM", actorId: "payment-risk-gateway",
    action: blocking ? "PAYMENT_RISK_BLOCKED" : "PAYMENT_RISK_ALLOWED",
    targetType: "payment_intent", targetId: input.clientRequestId ?? assessment.id,
    metadata: {
      evaluationReference: evaluation.reference,
      score: evaluation.score,
      classification: evaluation.classification,
      action: evaluation.action,
      ipHash: hashIp(input.ipAddress),
      note: "Decision only. No wallet or ledger mutation performed.",
    },
  });
  return {
    allow: !blocking,
    action: evaluation.action,
    evaluation,
    assessmentId: assessment.id,
    customerMessage: blocking ? (MESSAGES[evaluation.action] ?? "Additional verification is required.") : undefined,
  };
}

/** Post-transaction monitoring. Never relabels a settlement. */
export async function recordPostTransactionAssessment(input: {
  userId: string; paymentIntentId: string; clientRequestId?: string; amountMinor: number; outcome: string;
}) {
  const evaluation = await evaluateRisk({
    mode: "ASYNC_POST_TRANSACTION",
    subjectType: "PAYMENT",
    subjectId: input.paymentIntentId,
    userId: input.userId,
    context: { amountMinor: input.amountMinor, sourceModule: "payments" },
  });
  return prisma.transactionRiskAssessment.create({
    data: {
      paymentIntentId: input.paymentIntentId,
      clientRequestId: input.clientRequestId ?? null,
      userId: input.userId,
      amountMinor: input.amountMinor,
      evaluationId: evaluation.id,
      action: evaluation.action as never,
      outcome: input.outcome,
      originalIdempotencyKey: input.clientRequestId ?? null,
    },
  });
}

export function gatewayEnabled(): boolean {
  return getServerEnv().NEXUS_FRAUD_GATEWAY_ENABLED;
}

export function decisionClassification(score: number) {
  return classifyScore(score);
}
