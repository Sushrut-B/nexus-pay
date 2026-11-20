import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { foreignExpenseSchema } from "@nexus/validation";
import { listForeignExpenses, createForeignExpense } from "@/lib/global/global-expenses-service";
import { getDisplayCurrency } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 25, 60000);
    const display = request.nextUrl.searchParams.get("currency") ?? await getDisplayCurrency(auth.user.id);
    return jsonOk({ expenses: await listForeignExpenses(auth.user.id, display) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 20, 60000);
    const input = foreignExpenseSchema.parse(await readJsonBody(request));
    const id = await createForeignExpense(auth.user.id, {
      ...input,
      occurredAt: new Date(input.occurredAt),
    });
    return jsonOk({ id }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
