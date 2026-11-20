import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { z } from "zod";
import { reconcileTransfer } from "@/lib/global/international-payment-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  transferId: z.string().min(1),
  providerRef: z.string().min(2),
  outcome: z.enum(["CONFIRMED", "NOT_RECEIVED", "UNRESOLVED"]),
  detail: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const context = withRequest(await requireControl("global:write"), request);
    enforceRateLimitOrThrow("global-control:" + context.id, 15, 60000);
    const input = schema.parse(await readJsonBody(request));
    return jsonOk(await reconcileTransfer({ ...input, actorId: context.id }), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
