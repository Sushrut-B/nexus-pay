import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getReferralView } from "@/lib/rewards/referral-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const view = await getReferralView(user.id);
    const code = await prisma.referralCode.findUnique({ where: { userId: user.id } });
    const attributions = code
      ? await prisma.referralAttribution.findMany({
          where: { codeId: code.id },
          select: { id: true },
        })
      : [];
    const rewards = attributions.length
      ? await prisma.referralReward.findMany({
          where: { attributionId: { in: attributions.map((a) => a.id) } },
        })
      : [];
    return jsonOk({
      ...view,
      rewardsIssued: rewards.filter((reward) => reward.status === "ISSUED").length,
      rewardsPending: rewards.filter((reward) => reward.status === "PENDING").length,
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
