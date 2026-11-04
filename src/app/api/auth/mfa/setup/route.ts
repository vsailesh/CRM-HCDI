import { NextRequest } from "next/server";
import QRCode from "qrcode";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { encryptField } from "@/lib/secrets";
import { generateSecret, otpauthUri } from "@/lib/totp";

// POST /api/auth/mfa/setup — begin enrollment: issues a fresh pending secret + QR.
// Calling again before confirming just replaces the pending secret. Once enabled,
// only an admin reset can change it.
export async function POST(req: NextRequest) {
  const actor = actorOf(req);
  if (!actor) return bad("Not authenticated", 401);
  const staff = db.prepare("SELECT email, mfaEnabled FROM staff WHERE id = ?").get(actor.sub) as { email: string; mfaEnabled: number } | undefined;
  if (!staff) return bad("Not authenticated", 401);
  if (staff.mfaEnabled) return bad("MFA is already enabled. Ask an admin to reset it.", 409);

  const secret = generateSecret();
  db.prepare("UPDATE staff SET mfaSecret = ?, mfaLastStep = 0 WHERE id = ?").run(encryptField(secret), actor.sub);
  const uri = otpauthUri(secret, staff.email);
  logAudit({ actorId: actor.sub, actorName: actor.name, action: "mfa.setup_started", ip: clientIp(req) });
  return ok({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
}
