import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { blockedFields, canRead } from "@/lib/access";
import { getFields, getObject } from "@/lib/meta";
import { historyFor } from "@/lib/history";

type Ctx = { params: Promise<{ obj: string; id: string }> };

// GET — field change history for one record. Same access rules as the record: no access = not found,
// and fields the viewer is not allowed to see are removed (history must not leak what the record hides).
export async function GET(req: NextRequest, ctx: Ctx) {
  const { obj, id } = await ctx.params;
  const o = getObject(obj);
  const raw = o && (db.prepare("SELECT id, ownerId FROM srecords WHERE id = ? AND object = ?").get(id, obj) as { id: string; ownerId: string | null } | undefined);
  const viewer = viewerOf(req);
  if (!o || !raw || !canRead(obj, raw, viewer)) return bad("Record not found or you don't have access", 404);
  const fields = getFields(obj);
  const blocked = blockedFields(fields, viewer, raw.ownerId);
  const label = new Map(fields.map((f) => [f.api, f.label]));
  label.set("ownerId", "Owner");
  const staff = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const rows = historyFor(id).filter((h) => !blocked.has(h.field)).map((h) => h.field === "ownerId"
    ? { ...h, oldValue: staff.get(String(h.oldValue)) ?? null, newValue: staff.get(String(h.newValue)) ?? null }
    : h);
  if (o.phi) auditPhi(req, "read", obj, id, `history rows=${rows.length}`);
  return ok(rows.map((h) => ({ ...h, fieldLabel: label.get(h.field) ?? h.field })));
}
