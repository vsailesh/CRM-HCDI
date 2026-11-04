import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { logAudit, clientIp } from "@/lib/audit";
import { getFields, getObject, listObjects } from "@/lib/meta";
import { deleteRecord, getRecord, listRecords, updateRecord } from "@/lib/records";

type Ctx = { params: Promise<{ obj: string; id: string }> };

// GET — record + related lists (records in other objects pointing here) + Chatter feed
export async function GET(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const o = getObject(obj);
  const rec = o && getRecord(obj, id);
  if (!o || !rec) return bad("Record not found", 404);
  if (o.phi) auditPhi(req, "read", obj, id);

  const related = [];
  for (const other of listObjects()) {
    if (other.api === "chatter") continue;
    for (const f of getFields(other.api).filter((x) => x.type === "lookup" && x.ref === obj)) {
      const { rows, total } = listRecords(other.api, { filters: [{ field: f.api, op: "eq", value: id }], limit: 10 });
      if (total) {
        related.push({ object: other.api, label: other.plural, via: f.label, viaApi: f.api, total, listFields: other.listFields, rows });
        if (other.phi) auditPhi(req, "list", other.api, undefined, `related rows=${rows.length}`);
      }
    }
  }
  const feed = listRecords("chatter", { filters: [{ field: "relatedRecordId", op: "eq", value: id }], limit: 50, sort: "createdAt" }).rows;
  return ok({ record: rec, related, feed });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const b = await req.json().catch(() => ({}));
  const r = updateRecord(obj, id, b.values ?? {}, b.ownerId);
  if (r.errors.length) return bad(r.errors.join("; "), r.notFound ? 404 : 422);
  if (o.phi) auditPhi(req, "update", obj, id, `fields=${(r.changed ?? []).join(",")}`); // field names only, no values
  return ok({}, "Saved");
}

// DELETE — admin or record owner
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const a = actorOf(req);
  const row = db.prepare("SELECT ownerId, createdBy FROM srecords WHERE id = ? AND object = ?").get(id, obj) as { ownerId: string | null; createdBy: string | null } | undefined;
  if (!row) return bad("Record not found", 404);
  if (a?.role !== "admin" && a?.sub !== row.ownerId && a?.sub !== row.createdBy) return bad("Only the owner or an admin can delete this record", 403);
  const r = deleteRecord(obj, id);
  if (r.error) return bad(r.error, 409);
  logAudit({ actorId: a?.sub ?? null, actorName: a?.name ?? null, action: "phi.delete", resource: obj, resourceId: id, ip: clientIp(req) });
  return ok({}, "Deleted");
}
