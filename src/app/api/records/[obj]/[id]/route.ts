import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { logAudit, clientIp } from "@/lib/audit";
import { getFields, getObject, listObjects } from "@/lib/meta";
import { canEdit, canRead, levelOf } from "@/lib/access";
import { resetSlaMarks } from "@/lib/case-automation";
import { deleteRecord, getRecord, listRecords, updateRecord } from "@/lib/records";

type Ctx = { params: Promise<{ obj: string; id: string }> };

function rawRow(obj: string, id: string) {
  return db.prepare("SELECT id, ownerId, createdBy FROM srecords WHERE id = ? AND object = ?").get(id, obj) as { id: string; ownerId: string | null; createdBy: string | null } | undefined;
}
/** Missing and forbidden look identical to the caller (no existence leak); forbidden is audited. */
function denied(req: NextRequest, obj: string, id: string, what: string) {
  const a = actorOf(req);
  logAudit({ actorId: a?.sub ?? null, actorName: a?.name ?? null, action: `phi.${what}`, resource: obj, resourceId: id, outcome: "denied", ip: clientIp(req), detail: "no access to record" });
  return bad("Record not found or you don't have access", 404);
}

// GET — record + related lists (records in other objects pointing here) + Chatter feed
export async function GET(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const o = getObject(obj);
  const raw = o && rawRow(obj, id);
  if (!o || !raw) return bad("Record not found or you don't have access", 404);
  const viewer = viewerOf(req);
  if (!canRead(obj, raw, viewer)) return denied(req, obj, id, "read");
  const rec = getRecord(obj, id, viewer)!;
  if (o.phi) auditPhi(req, "read", obj, id);

  const related = [];
  for (const other of listObjects()) {
    if (other.api === "chatter") continue;
    for (const f of getFields(other.api).filter((x) => x.type === "lookup" && x.ref === obj)) {
      const { rows, total } = listRecords(other.api, { filters: [{ field: f.api, op: "eq", value: id }], limit: 10, viewer });
      if (total) {
        related.push({ object: other.api, label: other.plural, via: f.label, viaApi: f.api, total, listFields: other.listFields, rows });
        if (other.phi) auditPhi(req, "list", other.api, undefined, `related rows=${rows.length}`);
      }
    }
  }
  const feed = listRecords("chatter", { filters: [{ field: "relatedRecordId", op: "eq", value: id }], limit: 50, sort: "createdAt", viewer }).rows;
  const edit = canEdit(obj, raw, viewer);
  const manage = viewer.role === "admin" || raw.ownerId === viewer.id;
  return ok({ record: rec, related, feed, access: { level: levelOf(obj), edit, delete: manage, share: manage } });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const raw = rawRow(obj, id);
  if (!raw) return bad("Record not found or you don't have access", 404);
  const viewer = viewerOf(req);
  if (!canRead(obj, raw, viewer)) return denied(req, obj, id, "update");
  if (!canEdit(obj, raw, viewer)) {
    const a = actorOf(req);
    logAudit({ actorId: a?.sub ?? null, actorName: a?.name ?? null, action: "phi.update", resource: obj, resourceId: id, outcome: "denied", ip: clientIp(req), detail: "read-only access" });
    return bad("You have read-only access to this record", 403);
  }
  const b = await req.json().catch(() => ({}));
  // Only the owner or an admin may hand a record to someone else
  let ownerId: string | null | undefined = b.ownerId;
  if (ownerId !== undefined && (ownerId || null) !== raw.ownerId && viewer.role !== "admin" && raw.ownerId !== viewer.id) ownerId = undefined;
  const r = updateRecord(obj, id, b.values ?? {}, ownerId, viewer);
  if (r.errors.length) return bad(r.errors.join("; "), r.notFound ? 404 : 422);
  if (obj === "case" && (r.changed ?? []).some((c) => ["dueDate", "priority", "status"].includes(c))) resetSlaMarks(id);
  if (o.phi) auditPhi(req, "update", obj, id, `fields=${(r.changed ?? []).join(",")}`); // field names only, no values
  return ok({}, "Saved");
}

// DELETE — admin or record owner
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const a = actorOf(req);
  const row = rawRow(obj, id);
  if (!row) return bad("Record not found or you don't have access", 404);
  const viewer = viewerOf(req);
  if (!canRead(obj, row, viewer)) return denied(req, obj, id, "delete");
  if (a?.role !== "admin" && a?.sub !== row.ownerId && a?.sub !== row.createdBy) return bad("Only the owner or an admin can delete this record", 403);
  const r = deleteRecord(obj, id);
  if (r.error) return bad(r.error, 409);
  db.prepare("DELETE FROM record_shares WHERE recordId = ?").run(id);
  logAudit({ actorId: a?.sub ?? null, actorName: a?.name ?? null, action: "phi.delete", resource: obj, resourceId: id, ip: clientIp(req) });
  return ok({}, "Deleted");
}
