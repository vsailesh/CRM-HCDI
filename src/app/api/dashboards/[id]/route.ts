import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getObject } from "@/lib/meta";
import { aggregate, listRecords, type Filter } from "@/lib/records";

type Ctx = { params: Promise<{ id: string }> };
export type Widget = {
  id: string; type: "metric" | "bar" | "donut" | "table"; title: string; object: string; filters: Filter[];
  groupBy?: string; metric?: "count" | "sum" | "avg" | "min" | "max"; metricField?: string; limit?: number; width?: 1 | 2;
};

function load(id: string) {
  return db.prepare("SELECT * FROM dashboards WHERE id = ?").get(id) as any;
}

function run(w: Widget, req: NextRequest) {
  const o = getObject(w.object);
  if (!o) return { error: "Object no longer exists" };
  try {
    if (o.phi) auditPhi(req, "list", w.object, undefined, `dashboard widget ${w.type}`);
    if (w.type === "table") {
      const { rows, total } = listRecords(w.object, { filters: w.filters, limit: w.limit ?? 8, sort: "createdAt" });
      return { rows, total, listFields: o.listFields.slice(0, 4) };
    }
    return aggregate({ object: w.object, filters: w.filters, groupBy: w.type === "metric" ? undefined : w.groupBy, metric: w.metric, metricField: w.metricField, limit: w.limit });
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const d = load(id);
  if (!d) return bad("Dashboard not found", 404);
  const widgets: Widget[] = JSON.parse(d.widgets);
  return ok({ id: d.id, name: d.name, description: d.description, updatedAt: d.updatedAt, widgets: widgets.map((w) => ({ ...w, result: run(w, req) })) });
}

// PATCH { name?, description?, widgets? } — validates each widget's object / fields by dry-running it
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const d = load(id);
  if (!d) return bad("Dashboard not found", 404);
  const b = await req.json().catch(() => ({}));
  let widgets = d.widgets;
  if (b.widgets !== undefined) {
    if (!Array.isArray(b.widgets) || b.widgets.length > 30) return bad("Invalid widgets");
    for (const w of b.widgets as Widget[]) {
      if (!getObject(w.object)) return bad(`Unknown object: ${w.object}`);
      if (w.type !== "table") {
        try { aggregate({ object: w.object, filters: w.filters, groupBy: w.type === "metric" ? undefined : w.groupBy, metric: w.metric, metricField: w.metricField, limit: 1 }); }
        catch (e) { return bad(`${w.title}: ${(e as Error).message}`); }
      }
    }
    widgets = JSON.stringify(b.widgets);
  }
  db.prepare("UPDATE dashboards SET name=?, description=?, widgets=?, updatedAt=? WHERE id=?")
    .run(String(b.name ?? d.name), b.description ?? d.description, widgets, new Date().toISOString(), id);
  return ok({}, "Saved");
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const d = load(id);
  const a = actorOf(req);
  if (!d) return bad("Dashboard not found", 404);
  if (a?.role !== "admin" && a?.sub !== d.createdBy) return bad("Only the creator or an admin can delete this dashboard", 403);
  db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
  return ok({}, "Deleted");
}
