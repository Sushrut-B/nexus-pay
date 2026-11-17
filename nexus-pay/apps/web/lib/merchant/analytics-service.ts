import { prisma } from "@nexus/database";
import { createRaftlineClient } from "@nexus/api-client";
import type { MerchantAnalytics } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

export function resolveMerchantRange(range: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  if (from && to) {
    return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T23:59:59.999Z`) };
  }
  const days = range === "today" ? 1 : range === "week" ? 7 : range === "90days" ? 90 : 30;
  const fromDate = new Date(now);
  if (range === "today") fromDate.setUTCHours(0, 0, 0, 0);
  else fromDate.setUTCDate(fromDate.getUTCDate() - days);
  return { from: fromDate, to: now };
}

export async function getMerchantAnalytics(
  userId: string,
  range: string,
  from?: string,
  to?: string,
): Promise<MerchantAnalytics> {
  const merchant = await requireMerchantForUser(userId);
  const resolved = resolveMerchantRange(range, from, to);
  const where = { merchantId: merchant.id, createdAt: { gte: resolved.from, lte: resolved.to } };

  const [payments, refunds, customers, orders] = await Promise.all([
    prisma.merchantPayment.findMany({ where }),
    prisma.merchantRefundRequest.findMany({
      where: { merchantId: merchant.id, createdAt: { gte: resolved.from, lte: resolved.to }, status: { in: ["APPROVED", "PROCESSING", "SUCCEEDED"] } },
    }),
    prisma.merchantCustomer.findMany({ where: { merchantId: merchant.id } }),
    prisma.merchantOrder.count({ where }),
  ]);

  const successful = payments.filter((payment) => payment.status === "SETTLED");
  const gross = successful.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const refunded = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
  const repeatCustomers = customers.filter((customer) => customer.orderCount > 1).length;

  const dayMap = new Map<string, { date: string; amountMinor: number; count: number; refundedMinor: number }>();
  for (const payment of successful) {
    const date = payment.createdAt.toISOString().slice(0, 10);
    const entry = dayMap.get(date) ?? { date, amountMinor: 0, count: 0, refundedMinor: 0 };
    entry.amountMinor += payment.amountMinor;
    entry.count += 1;
    dayMap.set(date, entry);
  }
  for (const refund of refunds) {
    const date = refund.createdAt.toISOString().slice(0, 10);
    const entry = dayMap.get(date) ?? { date, amountMinor: 0, count: 0, refundedMinor: 0 };
    entry.refundedMinor += refund.amountMinor;
    dayMap.set(date, entry);
  }

  return {
    range: { from: resolved.from.toISOString(), to: resolved.to.toISOString() },
    grossVolumeMinor: gross,
    netVolumeMinor: Math.max(0, gross - refunded),
    successfulPayments: successful.length,
    failedPayments: payments.filter((payment) => payment.status === "REJECTED" || payment.status === "FAILED").length,
    refundedMinor: refunded,
    averageOrderValueMinor: successful.length === 0 ? 0 : Math.round(gross / successful.length),
    uniqueCustomers: new Set(successful.map((payment) => payment.customerUserId)).size,
    repeatCustomerRate: customers.length === 0 ? null : Math.round((repeatCustomers / customers.length) * 1000) / 10,
    byDay: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    currency: "INR",
    ...(orders ? {} : {}),
  };
}

export async function getMerchantDashboard(userId: string) {
  const merchant = await requireMerchantForUser(userId);
  const [payments, orders, customers, refunds] = await Promise.all([
    prisma.merchantPayment.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.merchantOrder.count({ where: { merchantId: merchant.id } }),
    prisma.merchantCustomer.count({ where: { merchantId: merchant.id } }),
    prisma.merchantRefundRequest.count({ where: { merchantId: merchant.id } }),
  ]);
  const settled = payments.filter((payment) => payment.status === "SETTLED");

  // Authoritative business balance: a live read from the mapped Raftline
  // account. Never derived from merchant order/payment metadata.
  let walletBalance: { availableMinor: number | null; currency: string; unavailableReason: string | null } = {
    availableMinor: null,
    currency: "INR",
    unavailableReason: merchant.raftlineAccountId ? "RAFTLINE_UNAVAILABLE" : "WALLET_NOT_PROVISIONED",
  };
  if (merchant.raftlineAccountId) {
    try {
      const account = await createRaftlineClient().getAccount(merchant.raftlineAccountId);
      if (account) {
        walletBalance = {
          availableMinor: account.availableBalanceCents,
          currency: account.currency,
          unavailableReason: null,
        };
      }
    } catch {
      // Leave the unavailable reason set; never guess a balance.
    }
  }

  return {
    merchant: {
      id: merchant.id,
      displayName: merchant.displayName,
      handle: merchant.handle,
      status: merchant.status,
      logoUrl: merchant.logoUrl,
      brandColor: merchant.brandColor,
    },
    totalVolumeMinor: settled.reduce((sum, payment) => sum + payment.amountMinor, 0),
    successfulPayments: settled.length,
    pendingPayments: payments.filter((payment) => payment.status === "PROCESSING" || payment.status === "CREATED").length,
    failedPayments: payments.filter((payment) => payment.status === "REJECTED" || payment.status === "FAILED").length,
    refundCount: refunds,
    orders,
    customers,
    recentPayments: payments,
    walletBalance,
  };
}

export async function listMerchantCustomers(userId: string) {
  const merchant = await requireMerchantForUser(userId);
  const customers = await prisma.merchantCustomer.findMany({
    where: { merchantId: merchant.id },
    orderBy: { lastPurchaseAt: "desc" },
    take: 100,
  });
  return customers.map((customer) => ({
    id: customer.id,
    displayName: customer.displayName,
    emailMasked: customer.email ? maskContact(customer.email, "@") : null,
    phoneMasked: customer.phone ? `••••${customer.phone.slice(-4)}` : null,
    totalPaidMinor: customer.totalPaidMinor,
    orderCount: customer.orderCount,
    lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
  }));
}

function maskContact(value: string, separator: string): string {
  const [local, domain] = value.split(separator);
  if (!domain) return "••••";
  return `${local?.slice(0, 1) ?? ""}••••@${domain}`;
}

export async function requireMerchantById(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new ApiError(404, "PAYMENT_ERROR", "Merchant not found.");
  return merchant;
}
