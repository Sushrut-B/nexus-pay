import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listCredits } from "@/lib/tax/tax-service";
import { prisma } from "@nexus/database";
import { taxCreditSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    return jsonOk({ items: await listCredits(auth.user.id, request.nextUrl.searchParams.get("financialYear") ?? "2025-26") }, requestId);
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

    const input = taxCreditSchema.parse(await readJsonBody(request));
    const row = await prisma.taxCreditRecord.upsert({ where: { userId_financialYear_kind_sourceRef: { userId: auth.user.id, financialYear: input.financialYear, kind: input.kind, sourceRef: input.sourceRef } }, create: { userId: auth.user.id, financialYear: input.financialYear, kind: input.kind, amountMinor: input.amountMinor, sourceRef: input.sourceRef, sourceType: "USER_DECLARED", verified: input.verified }, update: { amountMinor: input.amountMinor, verified: input.verified } }); return jsonOk(row, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
