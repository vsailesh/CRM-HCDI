import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const where = status === "all" ? "" : " WHERE f.status = ?";
  const params: unknown[] = status === "all" ? [] : [status];
  const rows = db.prepare(
    `SELECT f.*, c.name AS customerName, c.phone FROM followups f JOIN customers c ON c.id = f.customerId${where} ORDER BY f.dueAt ASC`
  ).all(...params);

  // stat cards always reflect the PENDING queue, regardless of active tab
  const pending = db.prepare(
    "SELECT dueAt FROM followups WHERE status = 'pending'"
  ).all() as Array<{ dueAt: string }>;
  const now = Date.now();
  const counts = { overdue: 0, today: 0, week: 0, all: pending.length };
  for (const r of pending) {
    const due = new Date(r.dueAt).getTime();
    if (due < now) counts.overdue++;
    else if (due < now + 86400000) counts.today++;
    else if (due < now + 7 * 86400000) counts.week++;
  }
  auditPhi(req, "list", "followups", undefined, `rows=${(rows as unknown[]).length}`);
  return ok({ data: rows, counts });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.customerId || !b?.title || !b?.dueAt) return bad("customerId, title, dueAt required");
  const id = `fu_${Date.now().toString(36)}`;
  db.prepare("INSERT INTO followups (id, customerId, title, dueAt, status, createdAt) VALUES (?,?,?,?,'pending',?)")
    .run(id, b.customerId, b.title, b.dueAt, new Date().toISOString());
  auditPhi(req, "create", "followups", id, `customer=${b.customerId}`);
  return ok({ id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.status) return bad("id and status required");
  db.prepare("UPDATE followups SET status = ? WHERE id = ?").run(b.status, b.id);
  auditPhi(req, "update", "followups", b.id, "status");
  return ok({ id: b.id, status: b.status });
}
