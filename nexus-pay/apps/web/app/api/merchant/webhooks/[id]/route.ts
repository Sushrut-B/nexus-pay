import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { deleteEndpoint, updateEndpoint } from "@/lib/merchant/webhook-service";
import { webhookUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const input = webhookUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateEndpoint(user.id, id, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    await deleteEndpoint(user.id, id);
    return jsonOk({ removed: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

