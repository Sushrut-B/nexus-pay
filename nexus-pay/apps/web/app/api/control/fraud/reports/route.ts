import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");

    return jsonOk({ items: await prisma.customerFraudReport.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

