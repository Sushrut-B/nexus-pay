import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("rewards:read");
    const status = request.nextUrl.searchParams.get("status");
    const rows = await prisma.rewardRiskEvent.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonOk({ items: rows }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
