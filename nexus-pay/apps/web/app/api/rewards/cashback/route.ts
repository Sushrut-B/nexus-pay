import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const rows = await prisma.cashbackEntitlement.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonOk({
      items: rows.map((row) => ({
        id: row.id,
        campaignId: row.campaignId,
        transactionRef: row.transactionRef,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        paymentRef: row.paymentRef,
        failureCategory: row.failureCategory,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
