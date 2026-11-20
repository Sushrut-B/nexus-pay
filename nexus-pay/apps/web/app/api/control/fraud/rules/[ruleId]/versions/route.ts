import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listRuleVersions } from "@/lib/fraud/rule-admin-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const requestId = getRequestId(request);
  try {
    await requireControl("fraud:read");
    const { ruleId } = await context.params;
    return jsonOk({ items: await listRuleVersions(ruleId) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

