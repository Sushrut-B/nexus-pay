import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { prisma } from "@nexus/database";
import { collectClusterSnapshot, getLatestOverview } from "@/lib/control/collector";
import { requireControl } from "@/lib/control/api-guard";
import { getChaosStatus, getChaosVerify } from "@/lib/control/raftline-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ nodeId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    await requireControl("nodes:read");
    const { nodeId } = await context.params;
    const overview = await collectClusterSnapshot().catch(() => getLatestOverview());
    const node = overview?.nodes.find((item) => item.nodeId === nodeId);
    if (!node) throw new ApiError(404, "AUTHORIZATION_ERROR", "That node is not configured.");
    const recent = await prisma.nodeObservation.findMany({
      where: { nodeId },
      orderBy: { observedAt: "desc" },
      take: 30,
    });
    const chaos = await getChaosStatus(node.httpUrl).catch(() => null);
    const verify = await getChaosVerify(node.httpUrl).catch(() => null);
    return jsonOk(
      {
        node,
        history: recent.map((item) => ({
          at: item.observedAt.toISOString(),
          reachable: item.reachable,
          role: item.role,
          term: item.term === null ? null : Number(item.term),
          responseTimeMs: item.responseTimeMs,
          error: item.error,
        })),
        chaos: chaos
          ? {
              isPaused: chaos.isPaused,
              isolatedPeers: chaos.isolatedPeers,
              recentEvents: chaos.recentEvents.slice(0, 10),
            }
          : null,
        verify: verify ? { status: verify.status, summary: verify.summary } : null,
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
