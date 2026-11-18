import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getUnifiedTransactions } from "@/lib/accounts/accounts-service";
import { accountQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const query = accountQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return jsonOk(await getUnifiedTransactions(user.id, query), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
