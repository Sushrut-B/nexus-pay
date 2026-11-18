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
    const status = request.nextUrl.searchParams.get("status");
    const invoices = await prisma.invoice.findMany({
      where: { ...(status ? { status: status as never } : {}) },
      include: { merchant: true, customer: { include: { profile: true } } },
      orderBy: { issueDate: "desc" },
      take: 200,
    });
    return jsonOk({
      items: invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        merchantName: invoice.merchant.displayName,
        customerName: invoice.customer.profile?.displayName ?? invoice.customer.fullName,
        customerEmail: invoice.customer.email,
        status: invoice.status,
        totalMinor: invoice.totalMinor,
        currency: invoice.currency,
        paymentRef: invoice.paymentRef,
        issueDate: invoice.issueDate.toISOString(),
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
