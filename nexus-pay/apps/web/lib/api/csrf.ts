import type { NextRequest } from "next/server";
import { appBaseUrl } from "@/lib/env";
import { CSRF_COOKIE } from "@/lib/auth/session";
import { safeEqual } from "@/lib/security/tokens";
import { ApiError } from "@/lib/api/response";

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = new Set([appBaseUrl().origin, request.nextUrl.origin]);
    if (!allowed.has(origin)) {
      throw new ApiError(403, "AUTHORIZATION_ERROR", "Request origin is not allowed.");
    }
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Cross-site requests are not allowed.");
  }
}

export function assertCsrfToken(request: NextRequest): void {
  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new ApiError(
      403,
      "AUTHORIZATION_ERROR",
      "Your session security token is missing. Refresh the page and try again.",
    );
  }
}

export function assertMutationRequest(request: NextRequest): void {
  assertSameOrigin(request);
  assertCsrfToken(request);
}
