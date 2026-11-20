import { prisma } from "@nexus/database";
import type { TravelOperationsView } from "@nexus/shared-types";

export async function getTravelOperations(): Promise<TravelOperationsView> {
  const [providers, available, searches, bookings, confirmed, unknown, cases, lastSync] = await Promise.all([
    prisma.travelProvider.count(),
    prisma.travelProvider.count({ where: { status: "AVAILABLE" } }),
    prisma.travelSearch.count(),
    prisma.travelBooking.count(),
    prisma.travelBooking.count({ where: { status: "CONFIRMED" } }),
    prisma.travelBooking.count({ where: { status: { in: ["UNKNOWN", "RECONCILIATION_REQUIRED"] } } }),
    prisma.travelReconciliationCase.count({ where: { status: "OPEN" } }),
    prisma.travelProvider.findFirst({ where: { lastSyncAt: { not: null } }, orderBy: { lastSyncAt: "desc" }, select: { lastSyncAt: true } }),
  ]);
  return {
    providers, availableProviders: available, searches, bookings,
    confirmedBookings: confirmed, unknownOutcomes: unknown, reconciliationCases: cases,
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null, currency: "INR",
  };
}

export async function listTravelProviders() {
  return prisma.travelProvider.findMany({ include: { capabilityRows: true }, orderBy: { code: "asc" } });
}

export async function listTravelBookings(limit = 100) {
  return prisma.travelBooking.findMany({ include: { provider: true }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function listTravelCases(limit = 100) {
  return prisma.travelReconciliationCase.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getTravelCase(id: string) {
  const row = await prisma.travelReconciliationCase.findFirst({ where: { OR: [{ id }, { reference: id }] } });
  if (!row) return null;
  const booking = row.bookingId
    ? await prisma.travelBooking.findUnique({ where: { id: row.bookingId }, include: { history: true, attempts: true } })
    : null;
  return { ...row, booking };
}

export async function assignTravelCase(id: string, assigneeId: string, actorId: string) {
  const row = await prisma.travelReconciliationCase.update({ where: { id }, data: { status: "INVESTIGATING", assignedTo: assigneeId } });
  await prisma.securityAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "TRAVEL_RECONCILIATION_ASSIGNED", targetType: "travel_reconciliation_case", targetId: id, metadata: { assigneeId } },
  });
  return row;
}

export async function resolveTravelCase(id: string, resolution: string, actorId: string) {
  const row = await prisma.travelReconciliationCase.update({
    where: { id }, data: { status: "RESOLVED", resolution, resolvedAt: new Date() },
  });
  await prisma.securityAuditEvent.create({
    data: { actorType: "ADMIN", actorId, action: "TRAVEL_RECONCILIATION_RESOLVED", targetType: "travel_reconciliation_case", targetId: id, justification: resolution },
  });
  return row;
}

export async function runTravelWorker() {
  const { runTravelSyncWorker } = await import("@/lib/travel/travel-webhook-service");
  return runTravelSyncWorker(25);
}
