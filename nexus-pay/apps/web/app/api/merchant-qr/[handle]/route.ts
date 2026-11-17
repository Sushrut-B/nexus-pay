import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`merchant-qr-view:${getClientIp(request)}`, 60, 60_000);
    const { handle } = await context.params;
    const merchant = await prisma.merchant.findUnique({ where: { handle } });
    if (!merchant || merchant.status !== "ACTIVE") {
      throw new ApiError(404, "PAYMENT_ERROR", "This merchant QR is not available.");
    }
    return jsonOk({
      handle: merchant.handle,
      displayName: merchant.displayName,
      logoUrl: merchant.logoUrl,
      status: merchant.status,
      walletActive: Boolean(merchant.raftlineAccountId),
      disclosure: "Nexus Pay QR only. Not a UPI QR or external payment app.",
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
