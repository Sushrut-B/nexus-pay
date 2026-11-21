import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { accountRecoveryCompleteSchema } from "@nexus/validation";
import { completeAccountRecovery } from "@/lib/identity/recovery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(`recovery-complete:${getClientIp(request)}`, 10, 15 * 60_000);
    const input = accountRecoveryCompleteSchema.parse(await readJsonBody(request));
    return jsonOk(await completeAccountRecovery(input), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
