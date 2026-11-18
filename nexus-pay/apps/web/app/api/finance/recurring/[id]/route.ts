import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { updatePattern } from "@/lib/finance-intelligence/recurring-service";
import { recurringPatternUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const input = recurringPatternUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updatePattern(user.id, id, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
