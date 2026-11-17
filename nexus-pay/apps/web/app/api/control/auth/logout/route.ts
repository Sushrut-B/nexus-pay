import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { revokeAdminSession } from "@/lib/control/auth";
import { requireControl, withRequest } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    withRequest(await requireControl(), request);
    await revokeAdminSession();
    return jsonOk({ signedOut: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
