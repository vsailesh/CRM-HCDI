import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { getObject, newId } from "@/lib/meta";

export async function GET() {
  const rows = db.prepare("SELECT id,name,config,createdAt FROM reports ORDER BY createdAt DESC").all() as any[];
  return ok(rows.map((r) => ({ id: r.id, name: r.name, config: JSON.parse(r.config), createdAt: r.createdAt })));
}

// POST { name, config:{object, filters, groupBy, metric, metricField, columns} }
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  const b = await req.json().catch(() => ({}));
  if (!String(b.name ?? "").trim()) return bad("Name is required");
  if (!getObject(b.config?.object)) return bad("Choose an object");
  const id = newId("rpt");
  db.prepare("INSERT INTO reports (id,name,config,createdBy,createdAt) VALUES (?,?,?,?,?)")
    .run(id, String(b.name).trim(), JSON.stringify(b.config), a?.sub ?? null, new Date().toISOString());
  return ok({ id }, "Saved");
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const a = actorOf(req);
  const r = db.prepare("SELECT createdBy FROM reports WHERE id = ?").get(id) as { createdBy: string | null } | undefined;
  if (!r) return bad("Report not found", 404);
  if (a?.role !== "admin" && a?.sub !== r.createdBy) return bad("Only the creator or an admin can delete this report", 403);
  db.prepare("DELETE FROM reports WHERE id = ?").run(id);
  return ok({}, "Deleted");
}
