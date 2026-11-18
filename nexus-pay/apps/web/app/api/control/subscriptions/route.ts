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
    const q = request.nextUrl.searchParams.get("q")?.trim();
    const status = request.nextUrl.searchParams.get("status");
    const rows = await prisma.subscription.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(q
          ? {
              OR: [
                { id: { contains: q, mode: "insensitive" } },
                { plan: { name: { contains: q, mode: "insensitive" } } },
                { merchant: { businessName: { contains: q, mode: "insensitive" } } },
                { customer: { email: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { merchant: true, plan: true, customer: { include: { profile: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return jsonOk({
      items: rows.map((row) => ({
        id: row.id,
        planName: row.plan.name,
        merchantName: row.merchant.displayName,
        merchantId: row.merchantId,
        customerName: row.customer.profile?.displayName ?? row.customer.fullName,
        customerEmail: row.customer.email,
        status: row.status,
        amountMinor: (row.pricingSnapshot as { amountMinor: number }).amountMinor,
        currency: row.plan.currency,
        nextBillingDate: row.nextBillingDate?.toISOString() ?? null,
        occurrenceCount: row.occurrenceCount,
        createdAt: row.createdAt.toISOString(),
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
