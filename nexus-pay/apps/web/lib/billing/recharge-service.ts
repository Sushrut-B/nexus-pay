import { randomUUID } from "node:crypto";
import { prisma, type RechargeStatus, type RechargeIntent } from "@nexus/database";
import type { RechargeView } from "@nexus/shared-types";
import type { RechargeCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getBillerAdapter } from "@/lib/billing/providers";
import { getInternalBiller } from "@/lib/billing/catalog-service";
import { ensureCollectionUser } from "@/lib/billing/collection-account";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { getOrCreatePaymentIntent, executePaymentIntent } from "@/lib/payments/payment-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

const TRANSITIONS: Record<RechargeStatus, RechargeStatus[]> = {
  CREATED: ["VALIDATION_PENDING", "VALIDATED", "PAYMENT_PENDING", "FAILED"],
  VALIDATION_PENDING: ["VALIDATED", "FAILED"],
  VALIDATED: ["PAYMENT_PENDING", "FAILED"],
  PAYMENT_PENDING: ["PROCESSING", "SUCCESS", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  PROCESSING: ["SUCCESS", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  SUCCESS: ["REFUND_PENDING"], FAILED: [],
  UNKNOWN: ["SUCCESS", "FAILED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["SUCCESS", "FAILED", "REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"], REFUNDED: [],
};

const STAGE: Record<RechargeStatus, string> = {
  CREATED: "Awaiting validation", VALIDATION_PENDING: "Validating identifier", VALIDATED: "Validated",
  PAYMENT_PENDING: "Wallet debit processing", PROCESSING: "Operator processing",
  SUCCESS: "Recharge successful", FAILED: "Recharge failed", UNKNOWN: "Outcome unknown",
  RECONCILIATION_REQUIRED: "Reconciliation required", REFUND_PENDING: "Refund pending", REFUNDED: "Refunded",
};

export function rechargeView(row: RechargeIntent & { biller: { name: string } }): RechargeView {
  return {
    id: row.id, reference: row.reference, billerName: row.biller.name,
    amountMinor: row.amountMinor, status: row.status, paymentRef: row.paymentRef,
    providerRef: row.providerRef, createdAt: row.createdAt.toISOString(),
    isSandbox: true, notice: STAGE[row.status],
  };
}

async function load(userId: string, id: string) {
  const row = await prisma.rechargeIntent.findFirst({
    where: { OR: [{ id }, { reference: id }], userId }, include: { biller: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Recharge not found.");
  return row;
}

async function transition(id: string, target: RechargeStatus, actor: string, detail?: string) {
  const row = await prisma.rechargeIntent.findUniqueOrThrow({ where: { id } });
  if (row.status === target) return;
  if (!TRANSITIONS[row.status].includes(target)) throw new ApiError(409, "PAYMENT_ERROR", `Cannot move recharge from ${row.status} to ${target}.`);
  await prisma.rechargeIntent.update({ where: { id }, data: { status: target } });
  const count = await prisma.rechargeAttempt.count({ where: { rechargeId: id } });
  await prisma.rechargeAttempt.create({ data: { rechargeId: id, attemptNo: count + 1, outcome: target, detail } });
}

export async function createRecharge(userId: string, input: RechargeCreateInput) {
  const existing = await prisma.rechargeIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.userId === userId) return rechargeView(await load(userId, existing.id) as never);
  const biller = await getInternalBiller(input.billerId);
  if (!biller.supportsRecharge) throw new ApiError(409, "PAYMENT_ERROR", "This operator does not support recharges.");
  const adapter = getBillerAdapter((await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } })).code);
  if (!adapter.capabilities.recharge) throw new ApiError(409, "PAYMENT_ERROR", "The provider does not support recharges.");

  const validity = await adapter.validateCustomerDetails(biller.code, input.parameters);
  if (!validity.valid) throw new ApiError(400, "VALIDATION_ERROR", validity.message ?? "Invalid recharge identifier.");

  const row = await prisma.rechargeIntent.create({
    data: {
      reference: `recharge_${randomUUID()}`, userId, billerId: biller.id,
      accountId: input.accountId ?? null, planId: input.planId ?? null,
      idempotencyKey: input.idempotencyKey,
      providerRequestRef: `rechreq_${randomUUID().replace(/-/g, "")}`,
      amountMinor: input.amountMinor, status: "VALIDATED",
    },
    include: { biller: true },
  });
  await publishSecurityEvent({
    eventId: `recharge_init_${row.id}`, type: "RECHARGE_INITIATED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "billing", metadata: { billerId: biller.id, amountMinor: input.amountMinor },
  });
  return rechargeView(row as never);
}

export async function listRecharges(userId: string) {
  const rows = await prisma.rechargeIntent.findMany({ where: { userId }, include: { biller: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => rechargeView(row as never));
}

export async function getRecharge(userId: string, id: string) { return rechargeView(await load(userId, id) as never); }

/** Settlement through the existing engine, then provider submission. Same two-system separation as bills. */
export async function confirmRecharge(userId: string, id: string) {
  const recharge = await load(userId, id);
  if (!["CREATED", "VALIDATION_PENDING", "VALIDATED", "PAYMENT_PENDING", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(recharge.status)) {
    return rechargeView(recharge as never);
  }
  await transition(recharge.id, "PAYMENT_PENDING", userId);
  const biller = await getInternalBiller(recharge.billerId);
  const collection = await ensureCollectionUser(biller.code);
  const recipient = await searchRecipient(userId, collection.username);

  let result;
  try {
    const intent = await getOrCreatePaymentIntent(userId, {
      clientRequestId: recharge.idempotencyKey, recipientToken: recipient.recipientToken,
      amountMinor: recharge.amountMinor, description: `Recharge ${recharge.reference}`,
    });
    await prisma.rechargeIntent.update({ where: { id: recharge.id }, data: { paymentIntentId: intent.id } });
    result = await executePaymentIntent(intent.id, userId);
  } catch (error) {
    await transition(recharge.id, "FAILED", "system", error instanceof Error ? error.message.slice(0, 200) : "Engine error");
    throw error;
  }
  if (result.status === "REJECTED") {
    await transition(recharge.id, "FAILED", "system", result.rejectionCode ?? "Wallet rejected");
    await publishSecurityEvent({ eventId: `recharge_fail_${recharge.id}`, type: "RECHARGE_FAILED", occurredAt: new Date(), actorId: userId, subjectId: recharge.id, sourceModule: "billing" });
    return rechargeView(await load(userId, recharge.id) as never);
  }
  if (result.status !== "SETTLED" || !result.paymentRef) {
    await transition(recharge.id, "UNKNOWN", "system", "Wallet outcome unknown");
    await prisma.billReconciliationCase.create({
      data: { reference: `recon_${randomUUID()}`, rechargeId: recharge.id, userId, reason: "RECHARGE_WALLET_OUTCOME_UNKNOWN" },
    });
    return rechargeView(await load(userId, recharge.id) as never);
  }
  await prisma.rechargeIntent.update({ where: { id: recharge.id }, data: { paymentRef: result.paymentRef } });
  await transition(recharge.id, "PROCESSING", "system", result.paymentRef);

  const adapter = getBillerAdapter((await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } })).code);
  let providerResult;
  try {
    providerResult = await adapter.initiateRecharge({
      billerCode: biller.code, providerRequestRef: recharge.providerRequestRef,
      amountMinor: recharge.amountMinor, parameters: {},
    });
  } catch { providerResult = null; }
  if (!providerResult) {
    await transition(recharge.id, "UNKNOWN", "system", "Provider response unknown");
    await prisma.billReconciliationCase.create({
      data: { reference: `recon_${randomUUID()}`, rechargeId: recharge.id, userId, reason: "RECHARGE_PROVIDER_UNKNOWN" },
    });
    return rechargeView(await load(userId, recharge.id) as never);
  }
  await prisma.rechargeIntent.update({ where: { id: recharge.id }, data: { providerRef: providerResult.providerRef } });
  const status = await adapter.getRechargeStatus(providerResult.providerRef);
  if (status?.status === "SUCCESS") {
    await transition(recharge.id, "SUCCESS", "provider", providerResult.providerRef);
    await publishSecurityEvent({ eventId: `recharge_ok_${recharge.id}`, type: "RECHARGE_CONFIRMED", occurredAt: new Date(), actorId: userId, subjectId: recharge.id, sourceModule: "billing", transactionRef: providerResult.providerRef });
  } else {
    await transition(recharge.id, "RECONCILIATION_REQUIRED", "system", "Provider rejected after wallet settlement");
    await prisma.billReconciliationCase.create({
      data: { reference: `recon_${randomUUID()}`, rechargeId: recharge.id, userId, reason: "RECHARGE_PROVIDER_FAILED_AFTER_SETTLEMENT" },
    });
    await publishSecurityEvent({ eventId: `recharge_fail_${recharge.id}`, type: "RECHARGE_FAILED", occurredAt: new Date(), actorId: userId, subjectId: recharge.id, sourceModule: "billing" });
  }
  return rechargeView(await load(userId, recharge.id) as never);
}

export const RECHARGE_TRANSITIONS = TRANSITIONS;
