import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { deleteExpense, getExpense, updateExpense } from "@/lib/social/expense-service";
import { expenseUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ groupId: string; expenseId: string }> };

export async function GET(request: NextRequest, context: Params) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId, expenseId } = await context.params;
    return jsonOk(await getExpense(auth.user.id, groupId, expenseId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId, expenseId } = await context.params;
    const input = expenseUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateExpense(auth.user.id, groupId, expenseId, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId, expenseId } = await context.params;
    await deleteExpense(auth.user.id, groupId, expenseId);
    return jsonOk({ removed: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
