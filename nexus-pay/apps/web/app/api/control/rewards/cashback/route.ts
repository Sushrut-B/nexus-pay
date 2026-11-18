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
    const rows = await prisma.cashbackEntitlement.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const [users, campaigns] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.userId) } },
        select: { id: true, email: true },
      }),
      prisma.rewardCampaign.findMany({
        where: { id: { in: rows.map((row) => row.campaignId) } },
        select: { id: true, name: true },
      }),
    ]);
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
    return jsonOk({
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userEmail: emails.get(row.userId) ?? "",
        campaignName: campaignNames.get(row.campaignId) ?? "",
        transactionRef: row.transactionRef,
        amountMinor: row.amountMinor,
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
