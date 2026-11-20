import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { productId } = await context.params;
    const product = await prisma.travelProduct.findUnique({ where: { id: productId }, include: { prices: { orderBy: { capturedAt: "desc" }, take: 1 } } });
    if (!product) throw new ApiError(404, "PAYMENT_ERROR", "Travel product not found."); return jsonOk(product, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
