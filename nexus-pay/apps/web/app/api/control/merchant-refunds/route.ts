import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("payments:read");
    const refunds = await prisma.merchantRefundRequest.findMany({
      include: { merchant: true, payment: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return jsonOk({
      items: refunds.map((refund) => ({
        id: refund.id,
        merchantId: refund.merchantId,
        merchantName: refund.merchant.displayName,
        paymentRef: refund.payment.paymentRef,
        amountMinor: refund.amountMinor,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt.toISOString(),
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
