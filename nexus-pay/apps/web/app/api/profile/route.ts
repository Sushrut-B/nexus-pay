import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { profileUpdateSchema } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(`profile-update:${auth.user.id}`, 20, 10 * 60 * 1000);

    const body = await readJsonBody(request);
    const input = profileUpdateSchema.parse(body);

    const profile = await prisma.userProfile.update({
      where: { userId: auth.user.id },
      data: {
        displayName: input.displayName,
        preferredLanguage: input.preferredLanguage,
      },
    });

    await recordAudit({
      actorId: auth.user.id,
      action: AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: "user_profile",
      entityId: profile.id,
    });

    return jsonOk(
      {
        displayName: profile.displayName,
        preferredLanguage: profile.preferredLanguage,
        preferredCurrency: profile.preferredCurrency,
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
