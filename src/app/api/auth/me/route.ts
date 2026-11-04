import { NextRequest } from "next/server";
import { ok, bad } from "@/lib/api";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";

// GET /api/auth/me — current session identity
export async function GET(req: NextRequest) {
  const session = verifySession(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) return bad("not authenticated", 401);
  return ok({ id: session.sub, name: session.name, role: session.role, mfaSetupRequired: session.scope === "mfa-setup" });
}
