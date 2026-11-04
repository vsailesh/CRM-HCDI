import crypto from "crypto";
import db from "./db";

/**
 * Server-side sessions. The cookie holds a random opaque token; only its
 * SHA-256 is stored, so a DB leak cannot be replayed as a login. Sessions
 * expire after IDLE_MS of inactivity or ABSOLUTE_MS total, and can be revoked
 * (logout, staff deactivated, password change) — HIPAA §164.312(a)(2)(iii).
 */
export const AUTH_COOKIE = "vfv_session";
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export type SessionPayload = { sub: string; name: string; role: string; scope: "full" | "mfa-setup" };

/** MFA is mandatory unless explicitly disabled (VFV_REQUIRE_MFA=false, dev only). */
export const REQUIRE_MFA = process.env.VFV_REQUIRE_MFA !== "false";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(staffId: string, ip?: string | null, userAgent?: string | null, scope: "full" | "mfa-setup" = "full") {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, staffId, createdAt, lastActiveAt, expiresAt, ip, userAgent, scope) VALUES (?,?,?,?,?,?,?,?)"
  ).run(sha(token), staffId, now, now, now + ABSOLUTE_MS, ip ?? null, userAgent?.slice(0, 200) ?? null, scope);
  return { token, expires: new Date(now + ABSOLUTE_MS) };
}

/** Validates + slides the idle window. Returns null when missing/expired/revoked/inactive user. */
export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const now = Date.now();
  const row = db.prepare(
    `SELECT s.id, s.scope, s.lastActiveAt, s.expiresAt, s.revokedAt, t.id AS staffId, t.name, t.role, t.isActive
     FROM sessions s JOIN staff t ON t.id = s.staffId WHERE s.id = ?`
  ).get(sha(token)) as any;
  if (!row || row.revokedAt || !row.isActive) return null;
  if (row.expiresAt < now || now - row.lastActiveAt > IDLE_MS) return null;
  if (now - row.lastActiveAt > TOUCH_EVERY_MS) db.prepare("UPDATE sessions SET lastActiveAt = ? WHERE id = ?").run(now, row.id);
  return { sub: row.staffId, name: row.name, role: row.role, scope: row.scope };
}

/** After successful MFA enrollment, lift a limited session to full access. */
export function upgradeSession(token: string | undefined | null) {
  if (token) db.prepare("UPDATE sessions SET scope = 'full' WHERE id = ?").run(sha(token));
}

/** Revoke every session of a user except the one identified by keepToken. */
export function revokeOtherSessions(staffId: string, keepToken: string | undefined | null) {
  db.prepare("UPDATE sessions SET revokedAt = ? WHERE staffId = ? AND revokedAt IS NULL AND id != ?")
    .run(Date.now(), staffId, keepToken ? sha(keepToken) : "");
}

// --- MFA login challenges (password verified, second factor pending) ---
const CHALLENGE_MS = 5 * 60 * 1000;
export function createChallenge(staffId: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("DELETE FROM mfa_challenges WHERE expiresAt < ?").run(Date.now());
  db.prepare("INSERT INTO mfa_challenges (id, staffId, expiresAt) VALUES (?,?,?)").run(sha(token), staffId, Date.now() + CHALLENGE_MS);
  return token;
}
/** Counts an attempt; returns the staffId, or null if missing/expired/out of attempts (5). */
export function useChallenge(token: string): string | null {
  const row = db.prepare("SELECT staffId, expiresAt, attempts FROM mfa_challenges WHERE id = ?").get(sha(token)) as any;
  if (!row || row.expiresAt < Date.now() || row.attempts >= 5) return null;
  db.prepare("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?").run(sha(token));
  return row.staffId;
}
export function consumeChallenge(token: string) {
  db.prepare("DELETE FROM mfa_challenges WHERE id = ?").run(sha(token));
}

export function destroySession(token: string | undefined | null) {
  if (token) db.prepare("UPDATE sessions SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL").run(Date.now(), sha(token));
}

export function revokeAllSessions(staffId: string) {
  db.prepare("UPDATE sessions SET revokedAt = ? WHERE staffId = ? AND revokedAt IS NULL").run(Date.now(), staffId);
}

export function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    ...(expires ? { expires } : {}),
  };
}
