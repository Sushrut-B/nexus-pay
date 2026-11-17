import { prisma, type MerchantOrder } from "@nexus/database";
import type { MerchantOrderView, MerchantOrderStatus } from "@nexus/shared-types";
import type { MerchantOrderCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

export function toOrderView(order: MerchantOrder & { items: Array<{ id: string; title: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; sku: string | null }> }): MerchantOrderView {
  return {
    id: order.id,
    merchantId: order.merchantId,
    title: order.title,
    description: order.description,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    items: order.items.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
    subtotalMinor: order.subtotalMinor,
    taxMinor: order.taxMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    status: order.status,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

const orderInclude = { items: true } as const;

export async function createOrder(userId: string, input: MerchantOrderCreateInput): Promise<MerchantOrderView> {
  const merchant = await requireMerchantForUser(userId);
  const taxMinor = input.taxMinor ?? 0;
  const discountMinor = input.discountMinor ?? 0;
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  const total = subtotal + taxMinor - discountMinor;
  if (total <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Order total must be greater than zero.");
  if (discountMinor > subtotal + taxMinor) {
    throw new ApiError(400, "VALIDATION_ERROR", "Discount cannot exceed subtotal plus tax.");
  }

  const order = await prisma.merchantOrder.create({
    data: {
      merchantId: merchant.id,
      title: input.title,
      description: input.description ?? null,
      customerName: input.customerName ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      subtotalMinor: subtotal,
      taxMinor,
      discountMinor,
      totalMinor: total,
      currency: "INR",
      status: "CREATED",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      items: {
        create: input.items.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor: item.quantity * item.unitPriceMinor,
          sku: item.sku ?? null,
        })),
      },
    },
    include: orderInclude,
  });
  return toOrderView(order);
}

export async function listOrders(userId: string, filters: { status?: MerchantOrderStatus; limit?: number } = {}): Promise<MerchantOrderView[]> {
  const merchant = await requireMerchantForUser(userId);
  const orders = await prisma.merchantOrder.findMany({
    where: { merchantId: merchant.id, ...(filters.status ? { status: filters.status } : {}) },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });
  return orders.map(toOrderView);
}

export async function getOrderForUser(userId: string, orderId: string): Promise<MerchantOrderView> {
  const merchant = await requireMerchantForUser(userId);
  const order = await prisma.merchantOrder.findFirst({
    where: { id: orderId, merchantId: merchant.id },
    include: orderInclude,
  });
  if (!order) throw new ApiError(404, "AUTHORIZATION_ERROR", "Order not found.");
  return toOrderView(order);
}

export async function cancelOrder(userId: string, orderId: string): Promise<MerchantOrderView> {
  const merchant = await requireMerchantForUser(userId);
  const order = await prisma.merchantOrder.findFirst({ where: { id: orderId, merchantId: merchant.id } });
  if (!order) throw new ApiError(404, "AUTHORIZATION_ERROR", "Order not found.");
  if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(order.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "A settled order cannot be cancelled.");
  }
  const updated = await prisma.merchantOrder.update({
    where: { id: orderId },
    data: { status: "CANCELLED" },
    include: orderInclude,
  });
  return toOrderView(updated);
}

export async function getOrderForCheckout(orderId: string, merchantId: string) {
  const order = await prisma.merchantOrder.findFirst({
    where: { id: orderId, merchantId },
    include: orderInclude,
  });
  if (!order) throw new ApiError(404, "PAYMENT_ERROR", "Order not found.");
  return order;
}
