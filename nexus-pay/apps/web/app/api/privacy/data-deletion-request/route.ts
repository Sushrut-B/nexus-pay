import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { requestDataDeletion } from "@/lib/accounts/accounts-service";
import { dataDeletionRequestSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const input = dataDeletionRequestSchema.parse(await readJsonBody(request));
    return jsonOk(await requestDataDeletion(user.id, input.reason, input.accountId), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
