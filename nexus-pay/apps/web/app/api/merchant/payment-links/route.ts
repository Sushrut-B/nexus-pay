import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { createPaymentLink, listPaymentLinks } from "@/lib/merchant/payment-link-service";
import { merchantPaymentLinkCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const status = request.nextUrl.searchParams.get("status");
    return jsonOk({ items: await listPaymentLinks(user.id, status as never ?? undefined) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`merchant-link:${user.id}`, 20, 60_000);
    const input = merchantPaymentLinkCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createPaymentLink(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

