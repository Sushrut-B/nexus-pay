import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getConversation } from "@/lib/finance-intelligence/assistant-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    return jsonOk(await getConversation(user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
