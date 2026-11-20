import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { prisma } from "@nexus/database";
import { securityAudit } from "@/lib/fraud/audit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ warningId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { warningId } = await context.params;
    const row = await prisma.securityNotification.updateMany({
      where: { id: warningId, userId: auth.user.id },
      data: { status: "ACKNOWLEDGED" },
    });
    if (row.count === 0) throw new ApiError(404, "AUTHORIZATION_ERROR", "Warning not found.");
    await securityAudit({
      actorType: "USER", actorId: auth.user.id, action: "SECURITY_WARNING_ACKNOWLEDGED",
      targetType: "security_notification", targetId: warningId,
    });
    return jsonOk({ warningId, acknowledged: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
