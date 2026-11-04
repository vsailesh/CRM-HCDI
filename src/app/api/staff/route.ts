import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { generateTempPassword, hashPassword, passwordPolicyError } from "@/lib/password";
import { revokeAllSessions } from "@/lib/auth";
import { clientIp, logAudit } from "@/lib/audit";

const forbidden = () => bad("Admin access required", 403);

// GET /api/staff — team roster + headline metrics (credential fields never leave the server)
export async function GET() {
  const rows = (db.prepare("SELECT * FROM staff ORDER BY createdAt ASC").all() as any[]).map(
    ({ passwordHash: _ph, failedLogins: _fl, lockedUntil: _lu, mfaSecret: _ms, mfaRecovery: _mr, mfaLastStep: _mls, ...s }) => ({
      ...s,
      permissions: JSON.parse(s.permissions ?? "[]"),
      availability: s.isAvailable ? "available" : "busy",
      waCapacityUsed: s.currentActiveLeads,
      status: s.isActive ? "active" : "inactive",
      lastActiveAt: s.lastSeenAt ?? "",
    })
  );
  const metrics = db.prepare(
    `SELECT COUNT(*) AS totalStaff, SUM(isActive) AS activeStaff,
       (SELECT ROUND(100.0 * SUM(CASE WHEN l.status='converted' THEN 1 ELSE 0 END) / COUNT(*), 1) FROM leads l) AS conversionRate
     FROM staff`
  ).get();
  return ok({ data: rows, metrics });
}

// POST /api/staff — Add Staff Member (admin). No password supplied → a random one-time
// temp password is generated and returned once in the response.
export async function POST(req: NextRequest) {
  const actor = actorOf(req);
  if (actor?.role !== "admin") return forbidden();
  const b = await req.json().catch(() => null);
  if (!b?.name || !b?.email) return bad("name and email required");

  let password: string = b.password;
  let tempPassword: string | undefined;
  if (password) {
    const err = passwordPolicyError(password);
    if (err) return bad(err);
  } else {
    password = tempPassword = generateTempPassword();
  }

  const id = `stf_${Date.now().toString(36)}`;
  const perms = Array.isArray(b.permissions) && b.permissions.length ? JSON.stringify(b.permissions) : "[]";
  db.prepare(
    `INSERT INTO staff (id, staffCode, name, email, phone, role, department, designation, passwordHash, isActive, isAvailable, currentActiveLeads, maxActiveLeads, permissions, lastSeenAt, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,1,1,0,?,?,NULL,?)`
  ).run(
    id, `STF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, b.name, b.email, b.phone ?? null,
    b.role ?? "staff", b.department ?? null, b.designation ?? null,
    hashPassword(password), Number(b.maxActiveLeads ?? 0), perms, new Date().toISOString(),
  );
  logAudit({ actorId: actor.sub, actorName: actor.name, action: "staff.create", resource: "staff", resourceId: id, ip: clientIp(req) });
  return ok({ id, ...(tempPassword ? { tempPassword } : {}) });
}

// PATCH /api/staff — admins edit anything; any user may flip only their own availability
export async function PATCH(req: NextRequest) {
  const actor = actorOf(req);
  if (!actor) return bad("Not authenticated", 401);
  const b = await req.json().catch(() => null);
  if (!b?.id) return bad("id required");

  const selfAvailabilityOnly =
    actor.sub === b.id && Object.keys(b).every((k) => k === "id" || k === "isAvailable");
  if (actor.role !== "admin" && !selfAvailabilityOnly) return forbidden();

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const f of ["isActive", "role", "department", "designation", "name", "email", "phone", "isAvailable", "maxActiveLeads"] as const) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); params.push(b[f]); }
  }
  if (Array.isArray(b.permissions)) { sets.push("permissions = ?"); params.push(JSON.stringify(b.permissions)); }
  if (typeof b.password === "string" && b.password) {
    if (!db.prepare("SELECT 1 FROM staff WHERE id = ?").get(b.id)) return bad("staff not found", 404);
    const err = passwordPolicyError(b.password);
    if (err) return bad(err);
    sets.push("passwordHash = ?", "failedLogins = 0", "lockedUntil = 0");
    params.push(hashPassword(b.password));
  }
  if (b.resetMfa === true) {
    // Admin-only (selfAvailabilityOnly can't contain resetMfa). User re-enrolls at next login.
    sets.push("mfaEnabled = 0", "mfaSecret = NULL", "mfaRecovery = NULL", "mfaLastStep = 0");
  }
  if (!sets.length) return bad("nothing to update");
  params.push(b.id);
  db.prepare(`UPDATE staff SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  // Credential / privilege / activation changes invalidate existing logins.
  if (b.password || b.resetMfa === true || b.isActive === 0 || b.isActive === false || b.role !== undefined) revokeAllSessions(b.id);
  if (!selfAvailabilityOnly) {
    const fields = Object.keys(b).filter((k) => k !== "id");
    logAudit({
      actorId: actor.sub, actorName: actor.name, action: "staff.update", resource: "staff", resourceId: b.id,
      ip: clientIp(req), detail: `fields: ${fields.map((k) => (k === "password" ? "password(changed)" : k === "resetMfa" ? "mfa(reset)" : k)).join(",")}`,
    });
  }
  return ok({ id: b.id });
}

// DELETE /api/staff?id= — remove a member (admin; reassigns nothing; customers keep history)
export async function DELETE(req: NextRequest) {
  const actor = actorOf(req);
  if (actor?.role !== "admin") return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  if (id === actor.sub) return bad("You cannot delete your own account");
  revokeAllSessions(id);
  const res = db.prepare("DELETE FROM staff WHERE id = ?").run(id);
  if (res.changes === 0) return bad("staff not found", 404);
  logAudit({ actorId: actor.sub, actorName: actor.name, action: "staff.delete", resource: "staff", resourceId: id, ip: clientIp(req) });
  return ok({ id, deleted: true });
}
