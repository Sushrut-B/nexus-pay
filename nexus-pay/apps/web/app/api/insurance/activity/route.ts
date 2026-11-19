import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();

const items = await prisma.insuranceActivity.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }); return jsonOk({ items }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
