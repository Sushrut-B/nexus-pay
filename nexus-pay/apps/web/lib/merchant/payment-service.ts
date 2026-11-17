import { prisma } from "@nexus/database";
import type { MerchantPaymentView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { toSocialParty } from "@/lib/social/shared";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { createWebhookEvent } from "@/lib/merchant/webhook-service";

export function toMerchantPaymentView(payment: {
  id: string;
  orderId: string | null;
  customerUserId: string;
  paymentRef: string;
  amountMinor: number;
  currency: string;
  status: string;
  source: string;
  refundedMinor: number;
  createdAt: Date;
}): MerchantPaymentView {
  return {
    id: payment.id,
    orderId: payment.orderId,
    customerUserId: payment.customerUserId,
    paymentRef: payment.paymentRef,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    source: payment.source,
    refundedMinor: payment.refundedMinor,
    createdAt: payment.createdAt.toISOString(),
  };
}

export interface ProcessMerchantPaymentInput {
  customerUserId: string;
  merchantId: string;
  amountMinor: number;
  clientRequestId: string;
  description: string;
  source: "PAYMENT_LINK" | "QR" | "CHECKOUT" | "DIRECT";
  orderId?: string;
  linkId?: string;
}

/**
 * All merchant money movement goes through the existing verified payment
 * service. This function never touches balances directly.
 */
export async function processMerchantPayment(
  input: ProcessMerchantPaymentInput,
): Promise<MerchantPaymentView> {
  const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant) throw new ApiError(404, "PAYMENT_ERROR", "Merchant not found.");
  if (merchant.status !== "ACTIVE" || !merchant.raftlineAccountId) {
    throw new ApiError(409, "PAYMENT_ERROR", "This merchant cannot accept payments.");
  }
  if (merchant.ownerUserId === input.customerUserId) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot pay your own merchant account.");
  }
  if (input.amountMinor <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Amount must be positive.");

  const owner = await prisma.user.findUniqueOrThrow({ where: { id: merchant.ownerUserId } });
  const recipient = await searchRecipient(input.customerUserId, owner.username);

  const intent = await getOrCreatePaymentIntent(input.customerUserId, {
    clientRequestId: input.clientRequestId,
    recipientToken: recipient.recipientToken,
    amountMinor: input.amountMinor,
    description: input.description,
  });
  const payment = await executePaymentIntent(intent.id, input.customerUserId);

  if (payment.status !== "SETTLED" || !payment.paymentRef) {
    // Unconfirmed outcomes remain unresolved everywhere.
    await createNotification(prisma, {
      userId: merchant.ownerUserId,
      type: "MERCHANT_PAYMENT_FAILED",
      title: "A merchant payment needs attention",
      body: `Payment for ${merchant.displayName} was not confirmed as settled.`,
      data: { merchantId: merchant.id, intentId: intent.id },
    });
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      payment.failureMessage ?? "The payment outcome could not be verified. No order was updated.",
    );
  }

  const storedIntent = await prisma.paymentIntent.findUnique({ where: { id: intent.id } });
  const idempotencyKey = storedIntent?.idempotencyKey ?? intent.id;

  let created = false;
  let record = await prisma.merchantPayment.findUnique({ where: { paymentIntentId: intent.id } });
  if (!record) {
    try {
      record = await prisma.merchantPayment.create({
        data: {
          merchantId: merchant.id,
          orderId: input.orderId ?? null,
          customerUserId: input.customerUserId,
          paymentIntentId: intent.id,
          paymentRef: payment.paymentRef,
          idempotencyKey,
          amountMinor: input.amountMinor,
          currency: "INR",
          status: "SETTLED",
          source: input.source,
          settledAt: new Date(),
        },
      });
      created = true;
    } catch {
      record = await prisma.merchantPayment.findUniqueOrThrow({ where: { paymentIntentId: intent.id } });
    }
  }

  if (created) {
    await prisma.$transaction(async (tx) => {
      if (input.orderId) {
        const order = await tx.merchantOrder.findFirst({
          where: { id: input.orderId, merchantId: merchant.id },
        });
        if (order && !["PAID", "REFUNDED"].includes(order.status)) {
          await tx.merchantOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
        }
      }
      if (input.linkId) {
        const link = await tx.merchantPaymentLink.findFirst({
          where: { id: input.linkId, merchantId: merchant.id },
        });
        if (link && (link.maxPayments === null || link.paymentCount < link.maxPayments)) {
          await tx.merchantPaymentLink.update({
            where: { id: link.id },
            data: {
              paymentCount: { increment: 1 },
              totalCollectedMinor: { increment: input.amountMinor },
              ...(link.maxPayments !== null && link.paymentCount + 1 >= link.maxPayments ? { status: "PAID" as const } : {}),
            },
          });
        }
      }

      const customer = await prisma.user.findUnique({ where: { id: input.customerUserId }, include: { profile: true } });
      if (customer) {
        const party = toSocialParty(customer);
        const existing = await tx.merchantCustomer.findUnique({
          where: { merchantId_userId: { merchantId: merchant.id, userId: input.customerUserId } },
        });
        if (existing) {
          await tx.merchantCustomer.update({
            where: { id: existing.id },
            data: {
              totalPaidMinor: { increment: input.amountMinor },
              orderCount: { increment: input.orderId ? 1 : 0 },
              lastPurchaseAt: new Date(),
            },
          });
        } else {
          await tx.merchantCustomer.create({
            data: {
              merchantId: merchant.id,
              userId: input.customerUserId,
              displayName: party.displayName,
              email: customer.email,
              phone: customer.phoneNumber,
              totalPaidMinor: input.amountMinor,
              orderCount: input.orderId ? 1 : 0,
              firstPurchaseAt: new Date(),
              lastPurchaseAt: new Date(),
            },
          });
        }
      }

      await createNotification(tx, {
        userId: merchant.ownerUserId,
        type: "MERCHANT_PAYMENT_RECEIVED",
        title: "Payment received",
        body: `${merchant.displayName} received ${input.amountMinor / 100} INR.`,
        data: { merchantId: merchant.id, paymentRef: payment.paymentRef },
      });

      // Transactional outbox: the event is stored with the state change but
      // delivery happens later in the webhook worker.
      await tx.merchantWebhookEvent.create({
        data: {
          merchantId: merchant.id,
          eventType: "payment.succeeded",
          payload: {
            paymentRef: payment.paymentRef,
            amountMinor: input.amountMinor,
            currency: "INR",
            orderId: input.orderId ?? null,
          } as object,
          status: "PENDING",
          availableAt: new Date(),
        },
      });
      if (input.orderId) {
        await tx.merchantWebhookEvent.create({
          data: {
            merchantId: merchant.id,
            eventType: "order.paid",
            payload: { orderId: input.orderId, paymentRef: payment.paymentRef } as object,
            status: "PENDING",
            availableAt: new Date(),
          },
        });
      }
    });
  }

  return toMerchantPaymentView(record);
}

export async function listMerchantPayments(userId: string): Promise<MerchantPaymentView[]> {
  const merchant = await prisma.merchant.findFirst({ where: { ownerUserId: userId } });
  if (!merchant) return [];
  const payments = await prisma.merchantPayment.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return payments.map(toMerchantPaymentView);
}

export async function getMerchantPayment(userId: string, id: string): Promise<MerchantPaymentView> {
  const merchant = await prisma.merchant.findFirst({ where: { ownerUserId: userId } });
  if (!merchant) throw new ApiError(404, "AUTHORIZATION_ERROR", "Merchant not found.");
  const payment = await prisma.merchantPayment.findFirst({ where: { id, merchantId: merchant.id } });
  if (!payment) throw new ApiError(404, "AUTHORIZATION_ERROR", "Payment not found.");
  return toMerchantPaymentView(payment);
}

export async function markPaymentRefunded(paymentId: string, amountMinor: number): Promise<void> {
  await prisma.merchantPayment.update({
    where: { id: paymentId },
    data: { refundedMinor: { increment: amountMinor } },
  });
}

export { createWebhookEvent };

