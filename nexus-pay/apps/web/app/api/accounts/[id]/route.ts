import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getAccount } from "@/lib/accounts/accounts-service";
import { disconnectConnection } from "@/lib/accounts/connections-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    return jsonOk(await getAccount(user.id, id), requestId);
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
    if (id === "nexus-wallet") {
      return jsonOk({ id, status: "RETAINED" }, requestId);
    }
    return jsonOk(await disconnectConnection(user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
