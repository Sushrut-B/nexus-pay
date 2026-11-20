import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listDeductions } from "@/lib/tax/tax-service";
import { prisma } from "@nexus/database";
import { taxDeductionSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    return jsonOk({ items: await listDeductions(auth.user.id, request.nextUrl.searchParams.get("financialYear") ?? "2025-26") }, requestId);
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
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const input = taxDeductionSchema.parse(await readJsonBody(request));
    const row = await prisma.taxDeductionRecord.create({ data: { userId: auth.user.id, financialYear: input.financialYear, ruleCode: input.ruleCode, section: input.ruleCode, label: input.ruleCode, amountMinor: input.amountMinor, regime: input.regime, date: input.date ? new Date(input.date) : null, note: input.note ?? null } }); return jsonOk(row, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
