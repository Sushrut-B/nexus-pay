import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { createAdmin, listAdmins, updateAdmin } from "@/lib/control/admin-service";
import { adminCreateSchema, adminRoleUpdateSchema } from "@nexus/validation";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("audit:read");
    return jsonOk({ items: await listAdmins() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("admin:write"), request);
    const input = adminCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createAdmin(input, admin, requestId), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("admin:write"), request);
    const body = (await readJsonBody(request)) as { id?: string } & Record<string, unknown>;
    if (!body.id) throw new Error("An administrator id is required.");
    const input = adminRoleUpdateSchema.parse(body);
    return jsonOk(await updateAdmin(body.id, input, admin, requestId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
