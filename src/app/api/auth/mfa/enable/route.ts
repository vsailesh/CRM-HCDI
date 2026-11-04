import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { AUTH_COOKIE, revokeOtherSessions, upgradeSession } from "@/lib/auth";
import { clientIp, logAudit } from "@/lib/audit";
import { decryptField } from "@/lib/secrets";
import { generateRecoveryCodes, verifyTotp } from "@/lib/totp";

// POST /api/auth/mfa/enable — { code }: confirm the authenticator works, turn MFA on,
// return one-time recovery codes (shown once), and lift the session to full access.
export async function POST(req: NextRequest) {
  const actor = actorOf(req);
  if (!actor) return bad("Not authenticated", 401);
  const b = await req.json().catch(() => null);
  if (!b?.code) return bad("code required");
  const staff = db.prepare("SELECT mfaSecret, mfaEnabled FROM staff WHERE id = ?").get(actor.sub) as { mfaSecret: string | null; mfaEnabled: number } | undefined;
  if (!staff?.mfaSecret) return bad("Start setup first", 400);
  if (staff.mfaEnabled) return bad("MFA is already enabled", 409);

  const step = verifyTotp(decryptField(staff.mfaSecret), String(b.code).replace(/\s/g, ""));
  if (step === null) {
    logAudit({ actorId: actor.sub, actorName: actor.name, action: "mfa.enable", outcome: "failure", ip: clientIp(req), detail: "bad code" });
    return bad("Invalid verification code", 401);
  }
  const { plain, hashed } = generateRecoveryCodes();
  db.prepare("UPDATE staff SET mfaEnabled = 1, mfaLastStep = ?, mfaRecovery = ? WHERE id = ?").run(step, JSON.stringify(hashed), actor.sub);
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  upgradeSession(token);
  revokeOtherSessions(actor.sub, token);
  logAudit({ actorId: actor.sub, actorName: actor.name, action: "mfa.enable", ip: clientIp(req) });
  return ok({ recoveryCodes: plain });
}
