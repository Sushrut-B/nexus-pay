import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { createReport, listReports } from "@/lib/fraud/report-service";
import { fraudReportSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk({ items: await listReports(auth.user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`fraud-report:${auth.user.id}`, 5, 60_000, "Too many reports submitted.");
    const input = fraudReportSchema.parse(await readJsonBody(request));
    return jsonOk(await createReport(auth.user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
