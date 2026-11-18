import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { revokeConsent } from "@/lib/accounts/connections-service";
import { consentActionSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const body = consentActionSchema.parse(await readJsonBody(request));
    return jsonOk(await revokeConsent(user.id, id, body.reason), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
