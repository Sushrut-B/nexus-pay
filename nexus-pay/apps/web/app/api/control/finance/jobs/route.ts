import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("finance:read");
    const jobs = await prisma.financialReportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { report: { select: { userId: true, type: true, status: true } } },
    });
    return jsonOk({
      items: jobs.map((job) => ({
        id: job.id,
        reportId: job.reportId,
        type: job.report.type,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
      })),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
