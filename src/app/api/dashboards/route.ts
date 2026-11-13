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
    gaps: [
      w("metric", "Open care gaps", "member_measure_status", { filters: [{ field: "gapStatus", op: "eq", value: "Open" }] }),
      w("metric", "Closed care gaps", "member_measure_status", { filters: [{ field: "gapStatus", op: "eq", value: "Closed" }] }),
      w("metric", "Gaps closed in last 30 days", "member_measure_status", { filters: [{ field: "closedDate", op: "lastDays", value: "30" }] }),
      w("bar", "Open gaps by measure", "member_measure_status", { groupBy: "measure", filters: [{ field: "gapStatus", op: "eq", value: "Open" }] }),
      w("bar", "Open gaps by health plan", "member_measure_status", { groupBy: "healthPlan", filters: [{ field: "gapStatus", op: "eq", value: "Open" }] }),
      w("donut", "How gaps were closed", "member_measure_status", { groupBy: "closeSource", filters: [{ field: "gapStatus", op: "eq", value: "Closed" }] }),
      w("bar", "Gaps closed per month", "member_measure_status", { groupBy: "closedDate:month", filters: [{ field: "gapStatus", op: "eq", value: "Closed" }] }),
      w("table", "Newest open gaps", "member_measure_status", { width: 2, limit: 8, filters: [{ field: "gapStatus", op: "eq", value: "Open" }] }),
    ],
    outreach: [
      w("metric", "Attempts last 30 days", "engagement_log", { filters: [{ field: "interactionDate", op: "lastDays", value: "30" }] }),
      w("metric", "Members reached (30 days)", "engagement_log", { filters: [{ field: "interactionDate", op: "lastDays", value: "30" }, { field: "outcome", op: "contains", value: "Reached" }] }),
      w("metric", "SDOH screenings (30 days)", "sdoh_assessment", { filters: [{ field: "assessmentDate", op: "lastDays", value: "30" }] }),
      w("bar", "Outcomes", "engagement_log", { groupBy: "outcome" }),
      w("bar", "Attempts per CHW", "engagement_log", { groupBy: "ownerId", filters: [{ field: "interactionDate", op: "lastDays", value: "30" }] }),
      w("donut", "Channels", "engagement_log", { groupBy: "channel" }),
      w("bar", "Attempts per month", "engagement_log", { groupBy: "interactionDate:month" }),
      w("donut", "SDOH referral status", "sdoh_assessment", { groupBy: "referralStatus" }),
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
