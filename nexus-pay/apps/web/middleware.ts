import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/home",
  "/onboarding",
  "/profile",
  "/wallet",
  "/add-money",
  "/funding",
  "/send",
  "/pay",
  "/receive",
  "/transactions",
  "/history",
  "/contacts",
  "/requests",
  "/groups",
  "/notifications",
];
const CSRF_COOKIE = "np_csrf";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Release 5 — Nexus Control has an isolated administrative session.
  const isControlLogin = pathname === "/control/login" || pathname === "/api/control/auth/login";
  const needsControl =
    (pathname === "/control" || pathname.startsWith("/control/") || pathname.startsWith("/api/control/")) &&
    !isControlLogin;
  if (needsControl && !request.cookies.get("np_control_session")?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { category: "AUTHENTICATION_ERROR", message: "Administrator sign-in required." } },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/control/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  const needsProtection = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsProtection && !request.cookies.get("np_session")?.value) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (request.method === "GET" && !request.cookies.get(CSRF_COOKIE)?.value) {
    const secure = (process.env.APP_URL ?? "").startsWith("https://");
    response.cookies.set(CSRF_COOKIE, randomToken(), {
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
