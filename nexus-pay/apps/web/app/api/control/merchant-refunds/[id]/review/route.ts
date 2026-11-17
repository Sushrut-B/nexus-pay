import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { reviewRefund } from "@/lib/merchant/refund-service";
import { recordAdminAudit } from "@/lib/control/audit";
import { refundReviewSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("reconciliation:write"), request);
    const { id } = await context.params;
    const input = refundReviewSchema.parse(await readJsonBody(request));
    const refund = await reviewRefund(id, input, admin);
    await recordAdminAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.roleName,
      action: "MERCHANT_REFUND_REVIEWED",
      targetType: "merchant_refund",
      targetId: id,
      reason: input.note,
      requestId,
      outcome: "SUCCESS",
      metadata: { decision: input.decision },
    });
    return jsonOk(refund, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
