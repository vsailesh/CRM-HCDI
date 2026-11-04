import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { newId } from "@/lib/meta";

export async function GET() {
  const rows = db.prepare("SELECT id,name,description,widgets,createdBy,updatedAt FROM dashboards ORDER BY updatedAt DESC").all() as any[];
  const staff = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  return ok(rows.map((r) => ({ id: r.id, name: r.name, description: r.description, updatedAt: r.updatedAt, widgetCount: JSON.parse(r.widgets).length, createdByName: staff.get(r.createdBy) ?? null })));
}

// POST { name, description?, template?: "cases" | "hedis" | "blank" }
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  if (!name) return bad("Name is required");
  const w = (type: string, title: string, object: string, extra: object = {}) => ({ id: newId("w"), type, title, object, filters: [], width: 1, ...extra });
  const templates: Record<string, object[]> = {
    cases: [
      w("metric", "Open cases", "case", { filters: [{ field: "status", op: "ne", value: "Closed" }] }),
      w("metric", "Urgent / High priority open", "case", { filters: [{ field: "status", op: "ne", value: "Closed" }, { field: "priority", op: "eq", value: "Urgent" }] }),
      w("metric", "Overdue open cases", "case", { filters: [{ field: "status", op: "ne", value: "Closed" }, { field: "dueDate", op: "overdue" }] }),
      w("bar", "Cases by status", "case", { groupBy: "status" }),
      w("donut", "Cases by type", "case", { groupBy: "type" }),
      w("bar", "Cases by owner", "case", { groupBy: "ownerId", filters: [{ field: "status", op: "ne", value: "Closed" }] }),
      w("table", "Newest cases", "case", { width: 2, limit: 8 }),
    ],
    hedis: [
      w("metric", "Active measures", "hedis_measure", { filters: [{ field: "status", op: "eq", value: "Active" }] }),
      w("metric", "Providers", "provider"),
      w("metric", "Households due for renewal", "household", { filters: [{ field: "renewalStatus", op: "eq", value: "Due Soon" }] }),
      w("bar", "Chart retrieval cases by provider", "case", { groupBy: "provider", filters: [{ field: "type", op: "eq", value: "Chart Retrieval" }] }),
      w("donut", "Providers by chart-retrieval method", "provider", { groupBy: "chartRetrievalMethod" }),
      w("bar", "Redetermination call outcomes", "redetermination_call", { groupBy: "outcome" }),
      w("bar", "Renewal status of calls", "redetermination_call", { groupBy: "renewalStatus" }),
    ],
  };
  const widgets = templates[String(b.template)] ?? [];
  const id = newId("dash");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO dashboards (id,name,description,widgets,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)")
    .run(id, name, b.description ?? null, JSON.stringify(widgets), a?.sub ?? null, now, now);
  return ok({ id }, "Created");
}
