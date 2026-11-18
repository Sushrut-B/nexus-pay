import { prisma } from "@nexus/database";
import type { AnomalySeverity, AnomalyStatus } from "@nexus/database";
import type { AnomalyView } from "@nexus/shared-types";
import type { AnomalyFeedbackInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { loadCategorizationMap } from "@/lib/finance-intelligence/aggregation-service";
import { loadClassifiedTransactions } from "@/lib/finance-intelligence/classification-service";

function toView(row: {
  id: string; category: string; severity: AnomalySeverity; reason: string;
  baselineMinor: number; observedMinor: number; confidence: string; status: AnomalyStatus;
  sourceId: string; createdAt: Date;
}): AnomalyView {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    reason: row.reason,
    baselineMinor: row.baselineMinor,
    observedMinor: row.observedMinor,
    confidence: row.confidence,
    status: row.status,
    sourceRef: row.sourceId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Informational anomaly detection — never a fraud determination. */
export async function detectAnomalies(userId: string): Promise<AnomalyView[]> {
  const now = new Date();
  const recent = await loadClassifiedTransactions(userId, new Date(now.getTime() - 30 * 86_400_000), now);
  const baseline = await loadClassifiedTransactions(userId, new Date(now.getTime() - 180 * 86_400_000), new Date(now.getTime() - 30 * 86_400_000));
  const map = await loadCategorizationMap(userId);
  const outgoing = (records: typeof recent.records, from: number, to: number) =>
    records.filter((record) => record.direction === "OUT" && !record.isAdjustment && record.occurredAt >= new Date(from) && record.occurredAt < new Date(to));

  const created: AnomalyView[] = [];
  const recentOut = outgoing(recent.records, now.getTime() - 30 * 86_400_000, now.getTime());
  const baselineOut = outgoing(baseline.records, now.getTime() - 180 * 86_400_000, now.getTime() - 30 * 86_400_000);

  for (const record of recentOut) {
    const category = map.get(record.paymentRef ?? "") ?? "OTHER";
    const peers = baselineOut.filter((item) => (map.get(item.paymentRef ?? "") ?? "OTHER") === category);
    if (peers.length < 5) continue;
    const average = Math.round(peers.reduce((sum, item) => sum + item.amountMinor, 0) / peers.length);
    if (average <= 0) continue;
    const ratio = record.amountMinor / average;
    if (ratio <= 1.8 || record.amountMinor - average < 10_000) continue;
    const severity: AnomalySeverity = ratio >= 3 ? "HIGH" : "MEDIUM";
    const reason = `${category} spending of ${(record.amountMinor / 100).toFixed(2)} INR is ${Math.round((ratio - 1) * 100)}% above the 5-month category baseline.`;
    try {
      const row = await prisma.spendingAnomaly.create({
        data: {
          userId, sourceType: record.sourceType, sourceId: record.sourceId, category,
          severity, reason, baselineMinor: average, observedMinor: record.amountMinor,
          confidence: peers.length >= 10 ? "MEDIUM" : "LOW", status: "OPEN",
        },
      });
      created.push(toView(row));
    } catch {
      // Duplicate anomaly — already recorded.
    }
  }
  return created;
}

export async function listAnomalies(userId: string, status?: AnomalyStatus): Promise<AnomalyView[]> {
  const rows = await prisma.spendingAnomaly.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(toView);
}

export async function feedbackAnomaly(userId: string, id: string, input: AnomalyFeedbackInput): Promise<AnomalyView> {
  const anomaly = await prisma.spendingAnomaly.findFirst({ where: { id, userId } });
  if (!anomaly) throw new ApiError(404, "AUTHORIZATION_ERROR", "Anomaly not found.");
  const updated = await prisma.spendingAnomaly.update({ where: { id }, data: { status: input.status } });
  return toView(updated);
}
