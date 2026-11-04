import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { runStageAutomations, runWorkflows } from "@/lib/automation";
import { normPhone } from "@/lib/phone";
import { pickOwner, bumpLoad } from "@/lib/assign";

// GET /api/customers?page&limit&q&status&source&staff&tab(active|archived-less: prospect|active)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const limit = Math.min(100, Number(sp.get("limit") ?? 20));
  const q = sp.get("q");
  const status = sp.get("status");
  const source = sp.get("source");
  const staff = sp.get("staff");
  const stage = sp.get("stage");

  let where = " WHERE 1=1";
  const params: unknown[] = [];
  if (q) { where += " AND (c.name LIKE ? OR c.phone LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  if (status) { where += " AND c.status = ?"; params.push(status); }
  else { where += " AND c.status != 'archived'"; }
  if (source) { where += " AND c.source = ?"; params.push(source); }
  if (staff) { where += " AND c.assignedStaffId = ?"; params.push(staff); }
  if (stage) { where += " AND c.leadStage = ?"; params.push(stage); }

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM customers c${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT c.*, s.name AS assignedStaffName FROM customers c LEFT JOIN staff s ON s.id = c.assignedStaffId${where}
     ORDER BY c.updatedAt DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);

  const stats = db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN source='whatsapp' THEN 1 ELSE 0 END) AS whatsapp,
       SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS activeCount
     FROM customers`
  ).get() as { total: number; whatsapp: number; activeCount: number };

  auditPhi(req, "list", "customers", undefined, `rows=${rows.length} total=${total}${q ? " searched" : ""}`);
  return ok({ data: rows, meta: { page, limit, total, pages: Math.ceil(total / limit) }, stats });
}

// POST /api/customers — Add New Customer modal
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.name || !b?.phone) return bad("name and phone required");

  // duplicate guard — same last-10-digits phone means same person
  const norm = normPhone(b.phone);
  if (norm.length === 10) {
    const all = db.prepare("SELECT id, name, phone FROM customers WHERE status != 'archived'").all() as Array<{ id: string; name: string; phone: string }>;
    const dupe = all.find((c) => normPhone(c.phone) === norm);
    if (dupe) {
      return Response.json(
        { statusCode: 409, message: "Duplicate: phone already on file", data: { existing: dupe } },
        { status: 409 }
      );
    }
  }

  const now = new Date().toISOString();
  const id = `cus_${Date.now().toString(36)}`;
  const owner = b.stage ? pickOwner() : null;
  db.prepare(
    `INSERT INTO customers (id, customerNumber, name, phone, email, address, city, state, pincode, businessName, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,0,0,?,?)`
  ).run(id, `BZ-C-${Date.now()}`, b.name, b.phone, b.email ?? null, b.address ?? null, b.city ?? null, b.state ?? null, b.pincode ?? null, b.businessName ?? null,
    "prospect", b.source ?? "manual", owner, b.stage ?? null, now, now);
  if (b.stage) {
    const lid = `lead_${Date.now().toString(36)}`;
    db.prepare("INSERT INTO leads (id, customerId, status, source, assignedStaffId, value, statusHistory, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(lid, id, b.stage, b.source ?? "manual", owner, Math.max(0, Math.round(Number(b.value) || 0)), JSON.stringify([{ status: b.stage, at: now }]), now, now);
    bumpLoad(owner, 1);
    runWorkflows("lead_created", id);
    runStageAutomations(b.stage, id);
  }
  auditPhi(req, "create", "customers", id);
  return ok({ id, assignedTo: owner });
}
