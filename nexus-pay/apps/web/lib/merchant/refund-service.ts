import { prisma } from "@nexus/database";
import type { RefundStatus, RefundView } from "@nexus/shared-types";
import type { RefundCreateInput, RefundReviewInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";
import { createWebhookEvent } from "@/lib/merchant/webhook-service";
import { createNotification } from "@/lib/social/shared";

function toView(refund: {
  id: string; paymentId: string; orderId: string | null; amountMinor: number; reason: string;
  type: string; status: RefundStatus; reviewNote: string | null; executionNote: string | null;
  createdAt: Date; resolvedAt: Date | null;
}): RefundView {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    orderId: refund.orderId,
    amountMinor: refund.amountMinor,
    reason: refund.reason,
    type: refund.type,
    status: refund.status,
    reviewNote: refund.reviewNote,
    executionNote: refund.executionNote,
    createdAt: refund.createdAt.toISOString(),
    resolvedAt: refund.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Raftline has no refund/reversal endpoint. This service handles request and
 * review only. It never moves money and never claims a refund succeeded.
 */
export async function createRefundRequest(userId: string, input: RefundCreateInput): Promise<RefundView> {
  const merchant = await requireMerchantForUser(userId);
  const payment = await prisma.merchantPayment.findFirst({
    where: { id: input.paymentId, merchantId: merchant.id },
  });
  if (!payment) throw new ApiError(404, "AUTHORIZATION_ERROR", "Payment not found.");
  if (payment.status !== "SETTLED") throw new ApiError(409, "PAYMENT_ERROR", "Only settled payments can be refunded.");

  const refunded = await prisma.merchantRefundRequest.aggregate({
    where: { paymentId: payment.id, status: { in: ["APPROVED", "PROCESSING", "SUCCEEDED"] } },
    _sum: { amountMinor: true },
  });
  const already = refunded._sum.amountMinor ?? 0;
  const refundable = payment.amountMinor - already;
  if (input.amountMinor > refundable) {
    throw new ApiError(409, "PAYMENT_ERROR", `Only ${refundable} paise remain refundable.`);
  }
  if (input.type === "FULL" && input.amountMinor !== payment.amountMinor - already) {
    throw new ApiError(400, "VALIDATION_ERROR", "A full refund must cover the remaining refundable amount.");
  }

  const refund = await prisma.merchantRefundRequest.create({
    data: {
      merchantId: merchant.id,
      paymentId: payment.id,
      orderId: payment.orderId,
      amountMinor: input.amountMinor,
      reason: input.reason,
      type: input.type,
      status: "REQUESTED",
      requestedBy: userId,
    },
  });
  await createWebhookEvent(merchant.id, "refund.requested", { refundId: refund.id, amountMinor: refund.amountMinor });
  await createNotification(prisma, {
    userId: merchant.ownerUserId,
    type: "MERCHANT_REFUND_REQUESTED",
    title: "Refund requested",
    body: `A refund of ${refund.amountMinor / 100} INR was requested.`,
    data: { refundId: refund.id, paymentId: payment.id },
  });
  return toView(refund);
}

export async function listRefunds(userId: string): Promise<RefundView[]> {
  const merchant = await requireMerchantForUser(userId);
  const refunds = await prisma.merchantRefundRequest.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return refunds.map(toView);
}

export async function reviewRefund(
  refundId: string,
  input: RefundReviewInput,
  admin: { id: string; email: string; roleName: string },
): Promise<RefundView> {
  const refund = await prisma.merchantRefundRequest.findUnique({ where: { id: refundId } });
  if (!refund) throw new ApiError(404, "AUTHORIZATION_ERROR", "Refund request not found.");
  if (!["REQUESTED", "UNDER_REVIEW"].includes(refund.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This refund request is already resolved.");
  }
  const status: RefundStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const executionNote =
    status === "APPROVED"
      ? "Approved for review only. Raftline has no verified refund/reversal operation; no money was moved."
      : input.note;
  const updated = await prisma.merchantRefundRequest.update({
    where: { id: refundId },
    data: {
      status,
      reviewedBy: admin.id,
      reviewNote: input.note,
      executionNote,
      resolvedAt: new Date(),
    },
  });
  await createWebhookEvent(
    refund.merchantId,
    status === "APPROVED" ? "refund.succeeded" : "refund.failed",
    { refundId, status, note: executionNote, executed: false },
  );
  return toView(updated);
}
