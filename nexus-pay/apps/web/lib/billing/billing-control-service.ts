import { prisma } from "@nexus/database";
import type { BillOperationsView } from "@nexus/shared-types";

export async function getBillOperations(): Promise<BillOperationsView> {
  const [
    providers, available, billers, payments, confirmed, recharges, unknown, cases, lastSync,
  ] = await Promise.all([
    prisma.billPaymentProvider.count(),
    prisma.billPaymentProvider.count({ where: { status: "AVAILABLE" } }),
    prisma.biller.count({ where: { status: "ACTIVE" } }),
    prisma.billPaymentIntent.count(),
    prisma.billPaymentIntent.count({ where: { status: "BILLER_CONFIRMED" } }),
    prisma.rechargeIntent.count(),
    prisma.billPaymentIntent.count({ where: { status: { in: ["UNKNOWN", "RECONCILIATION_REQUIRED"] } } }),
    prisma.billReconciliationCase.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
    prisma.billPaymentProvider.findFirst({ where: { lastSyncAt: { not: null } }, orderBy: { lastSyncAt: "desc" }, select: { lastSyncAt: true } }),
  ]);
  return {
    providers, availableProviders: available, billers, payments, confirmedPayments: confirmed,
    recharges, unknownOutcomes: unknown, reconciliationCases: cases,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null, currency: "INR",
  };
}

export async function listBillPayments(limit = 100) {
  return prisma.billPaymentIntent.findMany({ include: { biller: true }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function listRecharges(limit = 100) {
  return prisma.rechargeIntent.findMany({ include: { biller: true }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function listReconciliationCases(limit = 100) {
  return prisma.billReconciliationCase.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getReconciliationCase(id: string) {
  const row = await prisma.billReconciliationCase.findFirst({ where: { OR: [{ id }, { reference: id }] } });
  if (!row) return null;
  const payment = row.paymentId ? await prisma.billPaymentIntent.findUnique({ where: { id: row.paymentId }, include: { history: true, attempts: true } }) : null;
  return { ...row, payment };
}

export async function assignCase(id: string, assigneeId: string, actorId: string) {
  const row = await prisma.billReconciliationCase.update({
    where: { id }, data: { status: "INVESTIGATING", assignedTo: assigneeId },
  });
  await prisma.securityAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "BILL_RECONCILIATION_ASSIGNED", targetType: "bill_reconciliation_case", targetId: id, metadata: { assigneeId } },
  });
  return row;
}

export async function resolveCase(id: string, resolution: string, outcome: "RESOLVED" | "CLOSED", actorId: string) {
  const row = await prisma.billReconciliationCase.update({
    where: { id }, data: { status: outcome, resolution, resolvedAt: new Date() },
  });
  await prisma.securityAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "BILL_RECONCILIATION_RESOLVED", targetType: "bill_reconciliation_case", targetId: id, justification: resolution },
  });
  return row;
}

export async function getBillOverview(userId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [saved, upcoming, overdue, recent, payments, recharges, providers] = await Promise.all([
    prisma.savedBillerAccount.count({ where: { userId, status: "ACTIVE" } }),
    prisma.billSnapshot.count({ where: { fetchRequest: { userId }, dueDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) }, status: { not: "PAID" } } }),
    prisma.billSnapshot.count({ where: { fetchRequest: { userId }, dueDate: { lt: new Date() }, status: { not: "PAID" } } }),
    prisma.billPaymentIntent.count({ where: { userId } }),
    prisma.billPaymentIntent.findMany({ where: { userId, status: "BILLER_CONFIRMED", confirmedAt: { gte: since } } }),
    prisma.rechargeIntent.findMany({ where: { userId, status: "SUCCESS", updatedAt: { gte: since } } }),
    prisma.billPaymentProvider.count({ where: { status: "AVAILABLE" } }),
  ]);
  return {
    savedBillers: saved, upcomingDue: upcoming, overdue, recentPayments: recent,
    monthlySpendMinor: payments.reduce((sum, p) => sum + p.totalMinor, 0),
    rechargeSpendMinor: recharges.reduce((sum, r) => sum + r.amountMinor, 0),
    providersAvailable: providers, currency: "INR",
    notice: "Only provider-confirmed bill payments count as paid. Sandbox fixtures are not real billers.",
  };
}
