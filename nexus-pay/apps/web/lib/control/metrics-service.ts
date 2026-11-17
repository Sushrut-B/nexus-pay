import { prisma } from "@nexus/database";
import type { MetricsView } from "@nexus/shared-types";

export async function getMetrics(from: Date, to: Date): Promise<MetricsView> {
  const [snapshots, transitions, settled, rejected] = await Promise.all([
    prisma.clusterSnapshot.findMany({
      where: { observedAt: { gte: from, lte: to } },
      include: { nodes: true },
      orderBy: { observedAt: "asc" },
      take: 2000,
    }),
    prisma.leaderTransition.count({ where: { observedAt: { gte: from, lte: to } } }),
    prisma.paymentIntent.count({ where: { status: "SETTLED", settledAt: { gte: from, lte: to } } }),
    prisma.paymentIntent.count({ where: { status: "REJECTED", updatedAt: { gte: from, lte: to } } }),
  ]);

  const responseTimes = snapshots.flatMap((snapshot) => snapshot.nodes.map((node) => node.responseTimeMs));
  const averageResponseMs = responseTimes.length === 0
    ? null
    : Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length);

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    samples: snapshots.length,
    availability: snapshots.map((snapshot) => ({
      at: snapshot.observedAt.toISOString(),
      percentage: snapshot.totalNodes === 0 ? 0 : Math.round((snapshot.healthyNodes / snapshot.totalNodes) * 1000) / 10,
      healthy: snapshot.healthyNodes,
      total: snapshot.totalNodes,
    })),
    leaderChanges: transitions,
    paymentSettlements: settled,
    paymentFailures: rejected,
    successRate: settled + rejected === 0 ? null : Math.round((settled / (settled + rejected)) * 1000) / 10,
    averageResponseMs,
    replicationLag: "Not available",
    source: "NEXUS_OBSERVED",
  };
}

export function resolveRange(range: "hour" | "day" | "week" | "month"): { from: Date; to: Date } {
  const to = new Date();
  const hours = range === "hour" ? 1 : range === "day" ? 24 : range === "week" ? 24 * 7 : 24 * 30;
  return { from: new Date(to.getTime() - hours * 60 * 60 * 1000), to };
}
