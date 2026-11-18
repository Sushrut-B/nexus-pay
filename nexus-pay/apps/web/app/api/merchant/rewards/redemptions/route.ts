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
    const merchant = await prisma.merchant.findFirst({ where: { ownerUserId: user.id } });
    if (!merchant) return jsonOk({ items: [] }, requestId);
    const catalogue = await prisma.rewardCatalogueItem.findMany({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    const ids = catalogue.map((item) => item.id);
    const items = await prisma.rewardRedemption.findMany({
      where: { catalogueItemId: { in: ids } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonOk({ items }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
