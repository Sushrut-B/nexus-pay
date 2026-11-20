import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { removeDevice, setDeviceTrust } from "@/lib/fraud/device-service";
import { deviceTrustSchema } from "@nexus/validation";
import { readJsonBody } from "@/lib/api/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ deviceId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { deviceId } = await context.params;
    const input = deviceTrustSchema.parse({ ...(await readJsonBody(request)) as object, deviceId });
    const row = await setDeviceTrust(auth.user.id, deviceId, input.trusted, auth.user.id);
    return jsonOk({ deviceId: row.deviceId, trusted: row.trusted }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ deviceId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { deviceId } = await context.params;
    return jsonOk(await removeDevice(auth.user.id, deviceId, auth.user.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
