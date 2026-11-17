import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { getPaymentOperation } from "@/lib/control/payment-service";
import { recordAdminAudit } from "@/lib/control/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const admin = withRequest(await requireControl("payments:read"), request);
    const { id } = await context.params;
    const payment = await getPaymentOperation(id);
    await recordAdminAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.roleName,
      action: "PAYMENT_INVESTIGATED",
      targetType: "payment_intent",
      targetId: payment.intentId,
      requestId,
      outcome: "SUCCESS",
    });
    return jsonOk(payment, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
