import { randomBytes } from "node:crypto";
import { prisma, type MerchantPaymentLink } from "@nexus/database";
import type { PaymentLinkView, PaymentLinkStatus } from "@nexus/shared-types";
import type { PaymentLinkCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireActiveMerchant, requireMerchantForUser } from "@/lib/merchant/merchant-service";

function token(): string {
  return randomBytes(24).toString("base64url");
}

export function toLinkView(link: MerchantPaymentLink): PaymentLinkView {
  return {
    id: link.id,
    token: link.token,
    title: link.title,
    description: link.description,
    amountMinor: link.amountMinor,
    currency: link.currency,
    maxPayments: link.maxPayments,
    paymentCount: link.paymentCount,
    totalCollectedMinor: link.totalCollectedMinor,
    status: link.status,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    url: `/pay-link/${link.token}`,
    createdAt: link.createdAt.toISOString(),
  };
}

export async function createPaymentLink(userId: string, input: PaymentLinkCreateInput): Promise<PaymentLinkView> {
  const merchant = await requireActiveMerchant(userId);
  if (input.orderId) {
    const order = await prisma.merchantOrder.findFirst({ where: { id: input.orderId, merchantId: merchant.id } });
    if (!order) throw new ApiError(404, "AUTHORIZATION_ERROR", "Order not found.");
  }
  const link = await prisma.merchantPaymentLink.create({
    data: {
      merchantId: merchant.id,
      orderId: input.orderId ?? null,
      token: token(),
      title: input.title,
      description: input.description ?? null,
      amountMinor: input.amountMinor,
      currency: "INR",
      customerName: input.customerName ?? null,
      customerEmail: input.customerEmail ?? null,
      maxPayments: input.maxPayments ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      redirectUrl: input.redirectUrl ?? null,
      status: "ACTIVE",
    },
  });
  return toLinkView(link);
}

export async function listPaymentLinks(userId: string, status?: PaymentLinkStatus): Promise<PaymentLinkView[]> {
  const merchant = await requireMerchantForUser(userId);
  const links = await prisma.merchantPaymentLink.findMany({
    where: { merchantId: merchant.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return links.map(toLinkView);
}

export async function getPaymentLinkForUser(userId: string, id: string): Promise<PaymentLinkView> {
  const merchant = await requireMerchantForUser(userId);
  const link = await prisma.merchantPaymentLink.findFirst({ where: { id, merchantId: merchant.id } });
  if (!link) throw new ApiError(404, "AUTHORIZATION_ERROR", "Payment link not found.");
  return toLinkView(link);
}

export async function disablePaymentLink(userId: string, id: string): Promise<PaymentLinkView> {
  const merchant = await requireMerchantForUser(userId);
  const link = await prisma.merchantPaymentLink.findFirst({ where: { id, merchantId: merchant.id } });
  if (!link) throw new ApiError(404, "AUTHORIZATION_ERROR", "Payment link not found.");
  const updated = await prisma.merchantPaymentLink.update({
    where: { id },
    data: { status: "DISABLED" },
  });
  return toLinkView(updated);
}

/** Public resolution: never returns merchant account ids or private data. */
export async function resolvePublicLink(linkToken: string) {
  const link = await prisma.merchantPaymentLink.findUnique({
    where: { token: linkToken },
    include: { merchant: true },
  });
  if (!link) throw new ApiError(404, "PAYMENT_ERROR", "This payment link is invalid.");
  return link;
}

export async function resolveMerchantQr(handle: string) {
  const merchant = await prisma.merchant.findUnique({ where: { handle } });
  if (!merchant) throw new ApiError(404, "PAYMENT_ERROR", "This merchant could not be found.");
  return merchant;
}
