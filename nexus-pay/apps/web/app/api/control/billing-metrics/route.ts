import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("payments:read");
    const [subscriptions, occurrences, invoices, merchants] = await Promise.all([
      prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.billingOccurrence.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.invoice.aggregate({
        where: { status: { in: ["OPEN", "PAST_DUE"] } },
        _sum: { totalMinor: true },
        _count: { _all: true },
      }),
      prisma.merchant.count({ where: { subscriptions: { some: {} } } }),
    ]);
    const count = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
      rows.find((row) => row.status === status)?._count._all ?? 0;
    return jsonOk({
      subscriptions: {
        total: subscriptions.reduce((sum, row) => sum + row._count._all, 0),
        active: count(subscriptions, "ACTIVE"),
        trialing: count(subscriptions, "TRIALING"),
        pastDue: count(subscriptions, "PAST_DUE"),
        cancelled: count(subscriptions, "CANCELLED"),
      },
      occurrences: {
        settled: count(occurrences, "SETTLED"),
        failed: count(occurrences, "FAILED"),
        deadLettered: count(occurrences, "DEAD_LETTER"),
        unresolved: count(occurrences, "RECONCILIATION_REQUIRED"),
      },
      invoices: {
        outstandingMinor: invoices._sum.totalMinor ?? 0,
        outstandingCount: invoices._count._all,
      },
      merchantsWithSubscriptions: merchants,
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
