import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getReceiveProfile } from "@/lib/payments/recipient-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }
    enforceRateLimitOrThrow(
      `receive-qr:${auth.user.id}`,
      60,
      60 * 1000,
      "Too many QR refreshes. Please wait a moment.",
    );

    const profile = await getReceiveProfile(auth.user.id);
    const png = await QRCode.toBuffer(profile.paymentLink, {
      type: "png",
      width: 820,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    const download = request.nextUrl.searchParams.get("download") === "1";

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
        "X-Request-Id": requestId,
        "X-Content-Type-Options": "nosniff",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="nexus-pay-${profile.username}-qr.png"`,
            }
          : {}),
      },
    });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
