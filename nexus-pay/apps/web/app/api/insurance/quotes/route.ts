import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { createQuote, listQuotes } from "@/lib/insurance/quote-service";
import { insuranceQuoteCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    return jsonOk({ items: await listQuotes(user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`insurance-quote:${user.id}`, 10, 60_000);
    const input = insuranceQuoteCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createQuote(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
