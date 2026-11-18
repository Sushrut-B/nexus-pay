import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { initiateConnection } from "@/lib/accounts/connections-service";
import { connectAccountSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`accounts-connect:${user.id}`, 10, 60_000);
    const input = connectAccountSchema.parse(await readJsonBody(request));
    return jsonOk(await initiateConnection(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
