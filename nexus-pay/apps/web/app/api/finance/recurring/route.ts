import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { detectRecurringPatterns, listPatterns } from "@/lib/finance-intelligence/recurring-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    await detectRecurringPatterns(user.id);
    return jsonOk({ items: await listPatterns(user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
