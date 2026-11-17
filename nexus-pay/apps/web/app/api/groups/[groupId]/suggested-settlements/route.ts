import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { assertMembership } from "@/lib/social/group-service";
import { getSuggestedSettlements } from "@/lib/social/group-balance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId } = await context.params;
    await assertMembership(auth.user.id, groupId);
    return jsonOk(await getSuggestedSettlements(groupId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
