import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const row = await prisma.externalTransaction.findFirst({
      where: { id, userId: user.id },
      include: { account: { include: { connection: { include: { provider: true } } } } },
    });
    if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Transaction not found.");
    return jsonOk({
      id: row.id,
      source: "EXTERNAL",
      institution: row.account.institutionName,
      maskedAccount: row.account.maskedIdentifier,
      description: row.description,
      merchant: row.merchant,
      amountMinor: row.amountMinor,
      currency: row.currency,
      direction: row.direction,
      transactionAt: row.transactionAt.toISOString(),
      postedAt: row.postedAt?.toISOString() ?? null,
      status: row.status,
      category: row.category,
      externalRef: row.externalRef,
      isSandbox: row.account.connection.provider.mode === "SANDBOX",
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
