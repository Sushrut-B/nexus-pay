import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireControl();
    return jsonOk(
      { email: admin.email, username: admin.username, role: admin.role },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
