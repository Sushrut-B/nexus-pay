import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const loan = await prisma.activeLoan.findFirst({ where: { id, userId: user.id } });
    if (!loan) throw new ApiError(404, "AUTHORIZATION_ERROR", "Loan not found.");
    const application = await prisma.loanApplication.findFirst({ where: { id: loan.applicationId, userId: user.id } });
    const documents = application
      ? await prisma.loanDocument.findMany({
          where: { applicationId: application.id, userId: user.id, status: { not: "DELETED" } },
        })
      : [];
    return jsonOk({
      items: documents.map((doc) => ({
        id: doc.id, category: doc.category, fileName: doc.fileName,
        contentType: doc.contentType, status: doc.status, uploadedAt: doc.uploadedAt.toISOString(),
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
