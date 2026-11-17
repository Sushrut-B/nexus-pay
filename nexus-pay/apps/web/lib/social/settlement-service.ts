import { randomUUID } from "node:crypto";
import { prisma, type GroupSettlement } from "@nexus/database";
import type { SettlementListResult, SettlementStatus, SettlementView } from "@nexus/shared-types";
import type { SettlementCreateInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { assertMembership } from "@/lib/social/group-service";
import { getPairwiseObligation } from "@/lib/social/group-balance-service";
import { createNotification, loadParty, recordActivity, toSocialParty } from "@/lib/social/shared";

type SettlementWithUsers = GroupSettlement & {
  payer: Parameters<typeof toSocialParty>[0];
  payee: Parameters<typeof toSocialParty>[0];
};

const includeUsers = {
  payer: { include: { profile: true } },
  payee: { include: { profile: true } },
} as const;

async function loadSettlement(settlementId: string): Promise<SettlementWithUsers> {
  const settlement = await prisma.groupSettlement.findUnique({
    where: { id: settlementId },
    include: includeUsers,
  });
  if (!settlement) {
    throw new ApiError(404, "PAYMENT_ERROR", "That settlement could not be found.");
  }
  return settlement as SettlementWithUsers;
}

function toView(settlement: SettlementWithUsers): SettlementView {
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    payer: toSocialParty(settlement.payer),
    payee: toSocialParty(settlement.payee),
    amountMinor: Number(settlement.amountMinor),
    currency: settlement.currency,
    status: settlement.status,
    paymentRef: settlement.paymentRef,
    createdAt: settlement.createdAt.toISOString(),
    completedAt: settlement.completedAt?.toISOString() ?? null,
  };
}

export async function createSettlement(
  userId: string,
  groupId: string,
  input: SettlementCreateInput,
): Promise<SettlementView> {
  await assertMembership(userId, groupId);
  await assertMembership(input.payeeUserId, groupId);

  if (input.payeeUserId === userId) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot settle a debt with yourself.");
  }

  const existing = await prisma.groupSettlement.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: includeUsers,
  });
  if (existing) {
    if (existing.groupId !== groupId || existing.payerUserId !== userId) {
      throw new ApiError(403, "AUTHORIZATION_ERROR", "That settlement reference belongs to another request.");
    }
    return toView(existing as SettlementWithUsers);
  }

  const outstanding = await getPairwiseObligation(groupId, userId, input.payeeUserId);
  if (outstanding <= 0) {
    throw new ApiError(409, "PAYMENT_ERROR", "You do not owe this person anything in this group.");
  }
  if (input.amountMinor > outstanding) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      `You can settle at most ${outstanding} minor units with this person.`,
    );
  }

  try {
    const settlement = await prisma.groupSettlement.create({
      data: {
        groupId,
        payerUserId: userId,
        payeeUserId: input.payeeUserId,
        amountMinor: BigInt(input.amountMinor),
        currency: "INR",
        idempotencyKey: `np_settle_${randomUUID().replace(/-/g, "")}`,
        clientRequestId: input.clientRequestId,
        status: "PENDING",
      },
      include: includeUsers,
    });
    return toView(settlement as SettlementWithUsers);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const raced = await prisma.groupSettlement.findUnique({
        where: { clientRequestId: input.clientRequestId },
        include: includeUsers,
      });
      if (raced) return toView(raced as SettlementWithUsers);
    }
    throw error;
  }
}

export async function executeSettlement(
  userId: string,
  settlementId: string,
): Promise<SettlementView> {
  let settlement = await loadSettlement(settlementId);
  if (settlement.payerUserId !== userId) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Only the payer can confirm this settlement.");
  }
  if (["SETTLED", "FAILED", "RECONCILIATION_REQUIRED"].includes(settlement.status)) {
    return toView(settlement);
  }

  const recipient = await searchRecipient(userId, settlement.payee.username);
  const input = {
    clientRequestId: settlement.clientRequestId,
    recipientToken: recipient.recipientToken,
    amountMinor: Number(settlement.amountMinor),
    description: inputDescription(settlement),
  };

  const intent = await getOrCreatePaymentIntent(userId, input);
  const payment = await executePaymentIntent(intent.id, userId);

  let nextStatus: SettlementStatus | null = null;
  if (payment.status === "SETTLED" && payment.paymentRef) {
    nextStatus = "SETTLED";
  } else if (payment.status === "REJECTED") {
    nextStatus = "FAILED";
  } else if (payment.status === "UNKNOWN" || payment.status === "RECONCILIATION_REQUIRED") {
    nextStatus = "RECONCILIATION_REQUIRED";
  } else {
    nextStatus = "PROCESSING";
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupSettlement.update({
      where: { id: settlement.id },
      data: {
        status: nextStatus,
        paymentRef: payment.paymentRef,
        paymentIntentId: intent.id,
        completedAt: nextStatus === "SETTLED" ? new Date() : null,
      },
    });
    const me = await loadParty(tx, userId);
    await recordActivity(tx, {
      groupId: settlement.groupId,
      actorUserId: userId,
      eventType:
        nextStatus === "SETTLED"
          ? "SETTLEMENT_COMPLETED"
          : nextStatus === "FAILED"
            ? "SETTLEMENT_FAILED"
            : "SETTLEMENT_RECORDED",
      entityType: "settlement",
      entityId: settlement.id,
      metadata: {
        amountMinor: Number(settlement.amountMinor),
        status: nextStatus,
      },
    });
    await createNotification(tx, {
      userId: settlement.payeeUserId,
      type: nextStatus === "SETTLED" ? "SETTLEMENT_COMPLETED" : "SETTLEMENT_FAILED",
      title:
        nextStatus === "SETTLED"
          ? "A group settlement completed"
          : "A group settlement needs attention",
      body: `${me.displayName} ${nextStatus === "SETTLED" ? "paid you" : "attempted to pay you"} in a shared group.`,
      data: { groupId: settlement.groupId, settlementId: settlement.id },
    });
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
    entityType: "group_settlement",
    entityId: settlement.id,
    metadata: { amountMinor: Number(settlement.amountMinor), status: nextStatus },
  });

  settlement = await loadSettlement(settlementId);
  return toView(settlement);
}

function inputDescription(settlement: SettlementWithUsers): string {
  return `Group settlement ${settlement.id.slice(-6)}`;
}

export async function listSettlements(
  userId: string,
  groupId: string,
): Promise<SettlementListResult> {
  await assertMembership(userId, groupId);
  const settlements = await prisma.groupSettlement.findMany({
    where: { groupId, OR: [{ payerUserId: userId }, { payeeUserId: userId }] },
    include: includeUsers,
    orderBy: { createdAt: "desc" },
  });
  return {
    items: (settlements as SettlementWithUsers[]).map(toView),
    total: settlements.length,
  };
}

export async function getSettlement(
  userId: string,
  groupId: string,
  settlementId: string,
): Promise<SettlementView> {
  await assertMembership(userId, groupId);
  const settlement = await loadSettlement(settlementId);
  if (settlement.groupId !== groupId) {
    throw new ApiError(404, "PAYMENT_ERROR", "That settlement does not belong to this group.");
  }
  if (settlement.payerUserId !== userId && settlement.payeeUserId !== userId) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "You cannot view this settlement.");
  }
  return toView(settlement);
}

