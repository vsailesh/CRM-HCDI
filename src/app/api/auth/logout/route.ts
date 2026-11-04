import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, destroySession, verifySession } from "@/lib/auth";
import { clientIp, logAudit } from "@/lib/audit";

// POST /api/auth/logout — revokes the server-side session and clears the cookie
export async function POST(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const s = verifySession(token);
  destroySession(token);
  if (s) logAudit({ actorId: s.sub, actorName: s.name, action: "auth.logout", ip: clientIp(req) });
  const res = NextResponse.json({ statusCode: 200, data: { loggedOut: true }, message: "OK" });
  res.cookies.set(AUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
