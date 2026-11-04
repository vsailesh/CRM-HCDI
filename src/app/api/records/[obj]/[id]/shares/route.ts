import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ obj: string; id: string }> };

/** Only the record owner or an admin manages sharing. */
function guard(req: NextRequest, obj: string, id: string) {
  const a = actorOf(req);
  const row = db.prepare("SELECT ownerId FROM srecords WHERE id = ? AND object = ?").get(id, obj) as { ownerId: string | null } | undefined;
  if (!a || !row) return { err: bad("Record not found or you don't have access", 404) };
  if (a.role !== "admin" && a.sub !== row.ownerId) return { err: bad("Only the owner or an admin can change sharing", 403) };
  return { a, row };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const g = guard(req, obj, id);
  if (g.err) return g.err;
  return ok(db.prepare(
    `SELECT s.staffId, st.name, s.access, s.createdAt FROM record_shares s JOIN staff st ON st.id = s.staffId WHERE s.recordId = ? ORDER BY st.name`
  ).all(id));
}

// POST { staffId, access: "read" | "edit" }
export async function POST(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const g = guard(req, obj, id);
  if (g.err) return g.err;
  const b = await req.json().catch(() => ({}));
  const access = b.access === "edit" ? "edit" : b.access === "read" ? "read" : null;
  const target = db.prepare("SELECT id FROM staff WHERE id = ? AND isActive = 1").get(b.staffId);
  if (!access || !target) return bad("Choose an active team member and an access level");
  if (b.staffId === g.row!.ownerId) return bad("That person already owns this record");
  db.prepare(`INSERT INTO record_shares (recordId,staffId,access,grantedBy,createdAt) VALUES (?,?,?,?,?)
    ON CONFLICT(recordId,staffId) DO UPDATE SET access = excluded.access, grantedBy = excluded.grantedBy`).run(id, b.staffId, access, g.a!.sub, new Date().toISOString());
  logAudit({ actorId: g.a!.sub, actorName: g.a!.name, action: "access.share", resource: obj, resourceId: id, ip: clientIp(req), detail: `with=${b.staffId} access=${access}` });
  return ok({}, "Shared");
}

// DELETE ?staffId=
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const g = guard(req, obj, id);
  if (g.err) return g.err;
  const staffId = req.nextUrl.searchParams.get("staffId") ?? "";
  db.prepare("DELETE FROM record_shares WHERE recordId = ? AND staffId = ?").run(id, staffId);
  logAudit({ actorId: g.a!.sub, actorName: g.a!.name, action: "access.unshare", resource: obj, resourceId: id, ip: clientIp(req), detail: `with=${staffId}` });
  return ok({}, "Removed");
}
