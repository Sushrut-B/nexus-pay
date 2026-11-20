import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");

    const items = await prisma.securityNotification.findMany({ where: { userId: auth.user.id, type: "SECURITY_PAYMENT_WARNING" }, orderBy: { createdAt: "desc" }, take: 50 });
    return jsonOk({ items: items.map((item) => ({ id: item.id, kind: "PAYMENT_WARNING", title: item.title, message: item.body ?? "", severity: "HIGH", acknowledged: item.status === "ACKNOWLEDGED", createdAt: item.createdAt.toISOString() })) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
