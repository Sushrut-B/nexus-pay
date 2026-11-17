import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("leader:read");
    const events = await prisma.leaderTransition.findMany({
      orderBy: { observedAt: "desc" },
      take: 100,
    });
    return jsonOk(
      {
        items: events.map((event) => ({
          id: event.id,
          fromLeaderId: event.fromLeaderId,
          toLeaderId: event.toLeaderId,
          term: event.term === null ? null : Number(event.term),
          observedAt: event.observedAt.toISOString(),
          source: event.source,
        })),
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
