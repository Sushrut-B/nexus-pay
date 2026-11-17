import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getContact, removeContact } from "@/lib/social/contact-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function context(request: NextRequest, contextParams: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedUser();
  if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
  const { id } = await contextParams.params;
  return { userId: auth.user.id, id };
}

export async function GET(request: NextRequest, contextParams: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const { userId, id } = await context(request, contextParams);
    return jsonOk(await getContact(userId, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: NextRequest, contextParams: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const { userId, id } = await context(request, contextParams);
    await removeContact(userId, id);
    return jsonOk({ removed: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
