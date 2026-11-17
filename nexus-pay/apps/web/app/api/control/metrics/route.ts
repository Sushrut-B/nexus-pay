import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { getMetrics, resolveRange } from "@/lib/control/metrics-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("metrics:read");
    const rangeParam = request.nextUrl.searchParams.get("range") ?? "day";
    const range = (["hour", "day", "week", "month"] as const).includes(rangeParam as "hour")
      ? (rangeParam as "hour" | "day" | "week" | "month")
      : "day";
    const resolved = resolveRange(range);
    return jsonOk(await getMetrics(resolved.from, resolved.to), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
