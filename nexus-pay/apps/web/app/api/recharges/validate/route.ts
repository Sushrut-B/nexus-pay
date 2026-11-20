import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { z } from "zod";
import { getBillerAdapter } from "@/lib/billing/providers";
import { getInternalBiller } from "@/lib/billing/catalog-service";
import { prisma } from "@nexus/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`recharge-validate:${auth.user.id}`, 15, 60_000);
    const input = z.object({
      billerId: z.string().min(1).max(100),
      parameters: z.record(z.string().max(300)),
    }).parse(await readJsonBody(request));
    const biller = await getInternalBiller(input.billerId);
    const adapter = getBillerAdapter((await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } })).code);
    const result = await adapter.validateCustomerDetails(biller.code, input.parameters);
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

