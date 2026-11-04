import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { bad } from "@/lib/api";
import { AUTH_COOKIE, consumeChallenge, cookieOptions, createSession, useChallenge } from "@/lib/auth";
import { clientIp, logAudit } from "@/lib/audit";
import { throttle } from "@/lib/ratelimit";
import { decryptField } from "@/lib/secrets";
import { hashRecovery, verifyTotp } from "@/lib/totp";

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

// POST /api/auth/mfa/verify — { challenge, code } → full session.
// `code` is a 6-digit TOTP or a one-time recovery code (xxxxx-xxxxx).
export async function POST(req: NextRequest) {
  const limited = throttle(req, "mfa-verify", { perIp: 30, global: 300 });
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (!b?.challenge || !b?.code) return bad("challenge and code required", 400);
  const ip = clientIp(req);
  const staffId = useChallenge(String(b.challenge));
  if (!staffId) return bad("Verification expired. Sign in again.", 401);
  const staff = db.prepare("SELECT * FROM staff WHERE id = ? AND isActive = 1").get(staffId) as any;
  if (!staff || !staff.mfaEnabled || !staff.mfaSecret) return bad("Verification failed", 401);
  if (staff.lockedUntil > Date.now()) return bad("Account temporarily locked. Try again later.", 429);

  const code = String(b.code).trim();
  let good = false;
  let method = "totp";
  let recoveryLeft: number | undefined;

  const step = verifyTotp(decryptField(staff.mfaSecret), code.replace(/\s/g, ""));
  if (step !== null && step > staff.mfaLastStep) {
    // the step must advance, so a captured code can't be replayed inside its validity window
    db.prepare("UPDATE staff SET mfaLastStep = ? WHERE id = ?").run(step, staff.id);
    good = true;
  } else if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(code)) {
    const hashes: string[] = JSON.parse(staff.mfaRecovery ?? "[]");
    const h = hashRecovery(code);
    if (hashes.includes(h)) {
      const rest = hashes.filter((x) => x !== h);
      db.prepare("UPDATE staff SET mfaRecovery = ? WHERE id = ?").run(JSON.stringify(rest), staff.id);
      good = true;
      method = "recovery";
      recoveryLeft = rest.length;
    }
  }

  if (!good) {
    const fails = staff.failedLogins + 1;
    const lock = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
    db.prepare("UPDATE staff SET failedLogins = ?, lockedUntil = ? WHERE id = ?").run(lock ? 0 : fails, lock, staff.id);
    logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.mfa", outcome: "failure", ip, detail: lock ? "locked after repeated failures" : "bad code" });
    return bad("Invalid verification code", 401);
  }

  consumeChallenge(String(b.challenge));
  db.prepare("UPDATE staff SET failedLogins = 0, lockedUntil = 0, lastSeenAt = ? WHERE id = ?").run(new Date().toISOString(), staff.id);
  const { token, expires } = createSession(staff.id, ip, req.headers.get("user-agent"));
  logAudit({ actorId: staff.id, actorName: staff.name, action: "auth.login", ip, detail: `mfa:${method}` });
  const res = NextResponse.json({
    statusCode: 200,
    data: { id: staff.id, name: staff.name, role: staff.role, ...(recoveryLeft !== undefined ? { recoveryCodesLeft: recoveryLeft } : {}) },
    message: "OK",
  });
  res.cookies.set(AUTH_COOKIE, token, cookieOptions(expires));
  return res;
}
