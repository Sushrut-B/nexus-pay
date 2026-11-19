import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { deleteDocument, getDownloadLink } from "@/lib/insurance/document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const link = await getDownloadLink(user.id, id);
    return jsonOk({ ...link, url: `/api/insurance/documents/${encodeURIComponent(id)}/download?token=${link.token}&expiresAt=${link.expiresAt}` }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { id } = await context.params;
    return jsonOk(await deleteDocument(user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
