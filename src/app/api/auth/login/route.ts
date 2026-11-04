import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { bad } from "@/lib/api";
import { AUTH_COOKIE, REQUIRE_MFA, cookieOptions, createChallenge, createSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clientIp, logAudit } from "@/lib/audit";
import { throttle } from "@/lib/ratelimit";

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Verified against when the account doesn't exist, so timing doesn't reveal valid emails.
const DUMMY_HASH = hashPassword("not-a-real-password");

// POST /api/auth/login — { email, password } → sets vfv_session cookie
export async function POST(req: NextRequest) {
  // per-IP throttle stops one address from spraying many accounts; the global cap protects CPU (scrypt) without letting an attacker lock everyone out
  const limited = throttle(req, "login", { perIp: 20, global: 300 });
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (!b?.email || !b?.password) return bad("email and password required", 400);
  const ip = clientIp(req);
  const email = String(b.email);

  const staff = db.prepare("SELECT * FROM staff WHERE lower(email) = lower(?) AND isActive = 1").get(email) as any;
  const now = Date.now();

  if (staff && staff.lockedUntil > now) {
    logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.login", outcome: "denied", ip, detail: "account locked" });
    return bad("Account temporarily locked. Try again later.", 429);
  }

  const check = verifyPassword(email, String(b.password), staff?.passwordHash ?? DUMMY_HASH);
  if (!staff || !check.ok) {
    if (staff) {
      const fails = staff.failedLogins + 1;
      const lock = fails >= MAX_FAILS ? now + LOCK_MS : 0;
      db.prepare("UPDATE staff SET failedLogins = ?, lockedUntil = ? WHERE id = ?").run(lock ? 0 : fails, lock, staff.id);
      logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.login", outcome: "failure", ip, detail: lock ? "locked after repeated failures" : "bad password" });
    } else {
      logAudit({ action: "auth.login", outcome: "failure", ip, detail: "unknown account" });
    }
    return bad("Invalid email or password", 401);
  }

  if (check.needsRehash) db.prepare("UPDATE staff SET passwordHash = ? WHERE id = ?").run(hashPassword(String(b.password)), staff.id);
  db.prepare("UPDATE staff SET failedLogins = 0, lockedUntil = 0, lastSeenAt = ? WHERE id = ?").run(new Date().toISOString(), staff.id);

  // Second factor. Enrolled users must pass TOTP/recovery code before any session exists;
  // un-enrolled users get a limited session that can only reach MFA enrollment.
  if (staff.mfaEnabled) {
    logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.password_ok", ip, detail: "mfa required" });
    return NextResponse.json({ statusCode: 200, data: { mfaRequired: true, challenge: createChallenge(staff.id) }, message: "MFA required" });
  }
  const scope = REQUIRE_MFA ? "mfa-setup" : "full";
  const { token, expires } = createSession(staff.id, ip, req.headers.get("user-agent"), scope);
  logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.login", ip, detail: scope === "mfa-setup" ? "mfa enrollment required" : undefined });
  const res = NextResponse.json({ statusCode: 200, data: { id: staff.id, name: staff.name, role: staff.role, mfaSetupRequired: scope === "mfa-setup" }, message: "OK" });
  res.cookies.set(AUTH_COOKIE, token, cookieOptions(expires));
  return res;
}
