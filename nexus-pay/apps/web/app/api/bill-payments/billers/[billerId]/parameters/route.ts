import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ billerId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { billerId } = await context.params;
    const items = await prisma.billerParameter.findMany({ where: { billerId }, orderBy: { displayOrder: "asc" } }); return jsonOk({ items: items.map((p) => ({ name: p.name, label: p.label, required: p.required, sensitive: p.sensitive, validation: p.validation })) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

