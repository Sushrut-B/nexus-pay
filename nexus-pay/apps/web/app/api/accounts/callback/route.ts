import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { handleCallback } from "@/lib/accounts/connections-service";
import { providerCallbackSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`accounts-callback:${getClientIp(request)}`, 30, 60_000);
    const input = providerCallbackSchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return jsonOk(await handleCallback(input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
