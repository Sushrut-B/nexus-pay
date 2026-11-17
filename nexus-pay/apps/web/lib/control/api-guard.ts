import type { NextRequest } from "next/server";
import type { AdminRole } from "@nexus/shared-types";
import { ApiError, getRequestId } from "@/lib/api/response";
import { getAuthenticatedAdmin, hasPermission } from "@/lib/control/auth";
import { recordAdminAudit } from "@/lib/control/audit";
import { getServerEnv } from "@/lib/env";

export interface ControlContext {
  id: string;
  email: string;
  username: string;
  role: AdminRole;
  roleName: string;
  requestId: string;
  ip: string | null;
}

export async function requireControl(permission?: string): Promise<ControlContext> {
  if (!getServerEnv().NEXUS_CONTROL_ENABLED) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Nexus Control is disabled.");
  }
  const auth = await getAuthenticatedAdmin();
  if (!auth) {
    throw new ApiError(401, "AUTHENTICATION_ERROR", "Administrator sign-in required.");
  }
  const context: ControlContext = {
    id: auth.admin.id,
    email: auth.admin.email,
    username: auth.admin.username,
    role: auth.admin.role,
    roleName: auth.admin.role,
    requestId: "",
    ip: null,
  };
  if (permission && !hasPermission(auth.admin.role, permission)) {
    await recordAdminAudit({
      actorId: context.id,
      actorEmail: context.email,
      actorRole: context.roleName,
      action: "ADMIN_PERMISSION_DENIED",
      targetType: "api_permission",
      targetId: permission,
      outcome: "BLOCKED",
    });
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Your administrator role cannot perform this action.");
  }
  return context;
}

export function withRequest(context: ControlContext, request: NextRequest): ControlContext {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    ...context,
    requestId: getRequestId(request),
    ip: forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null,
  };
}
