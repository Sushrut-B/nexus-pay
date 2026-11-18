import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { rewardListQuerySchema } from "@nexus/validation";
import { paginationMeta } from "@/lib/rewards/reward-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const query = rewardListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const where = {
      userId: user.id,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.merchantId ? { merchantId: query.merchantId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.rewardActivity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.rewardActivity.count({ where }),
    ]);
    return jsonOk({ items, ...paginationMeta(total, query.page, query.pageSize) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
