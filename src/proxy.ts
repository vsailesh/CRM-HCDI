import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

/**
 * Route gate (Next 16 "proxy", Node runtime). Validates the server-side
 * session on every request (idle/absolute timeout, revocation), injects the
 * caller identity as trusted headers for route handlers, and adds security
 * headers. Client-supplied x-vfv-* headers are always discarded.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/mfa/verify", "/r", "/api/webhook/lead", "/api/health"];
const MFA_SETUP_PATHS = ["/mfa-setup", "/api/auth/mfa", "/api/auth/me", "/api/auth/logout"];

function secure(res: NextResponse, noStore: boolean) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (noStore) res.headers.set("Cache-Control", "no-store"); // PHI must not sit in browser/proxy caches
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  for (const h of ["x-vfv-staff-id", "x-vfv-staff-name", "x-vfv-staff-role"]) headers.delete(h);

  const session = verifySession(req.cookies.get(AUTH_COOKIE)?.value);
  if (session) {
    headers.set("x-vfv-staff-id", session.sub);
    headers.set("x-vfv-staff-name", encodeURIComponent(session.name));
    headers.set("x-vfv-staff-role", session.role);
  }

  // Password-verified but MFA not yet enrolled: the session may only reach enrollment.
  if (session?.scope === "mfa-setup" && !MFA_SETUP_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (pathname.startsWith("/api/")) {
      return secure(NextResponse.json({ statusCode: 403, data: null, message: "MFA enrollment required" }, { status: 403 }), true);
    }
    return secure(NextResponse.redirect(new URL("/mfa-setup", req.url)), true);
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) || session) {
    return secure(NextResponse.next({ request: { headers } }), true);
  }

  if (pathname.startsWith("/api/")) {
    return secure(NextResponse.json({ statusCode: 401, data: null, message: "Not authenticated" }, { status: 401 }), true);
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return secure(NextResponse.redirect(url), true);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|.*\.png$|.*\.svg$).*)"],
};
