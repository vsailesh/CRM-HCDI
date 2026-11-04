import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { STAGES } from "@/lib/db";
import { leadScore } from "@/lib/lead-score";
import { runStageAutomations, runWorkflows } from "@/lib/automation";
import { pickOwner, bumpLoad, stageTransition } from "@/lib/assign";

const STAGE_KEYS = STAGES.map((s) => s.key);

type LeadRow = {
  id: string; status: string; source: string; noteCount: number; activityCount: number; value: number;
  createdAt: string; updatedAt: string; customerId: string; fullName: string; phone: string;
  email: string | null; customerStatus: string; assignedToStaffName: string | null;
};

// GET /api/leads?page=1&limit=20&status=new&q=search
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const limit = Math.min(100, Number(sp.get("limit") ?? 20));
  const status = sp.get("status");
  const q = sp.get("q");

  let where = " WHERE 1=1";
  const params: unknown[] = [];
  if (status && STAGE_KEYS.includes(status as never)) {
    where += " AND l.status = ?";
    params.push(status);
  }
  if (q) {
    where += " AND (c.name LIKE ? OR c.phone LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM leads l JOIN customers c ON c.id = l.customerId${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT l.id, l.status, l.source, l.noteCount, l.activityCount, l.value, l.createdAt, l.updatedAt,
            c.id AS customerId, c.name AS fullName, c.phone, c.email, c.status AS customerStatus,
            s.name AS assignedToStaffName
     FROM leads l
     JOIN customers c ON c.id = l.customerId
     LEFT JOIN staff s ON s.id = l.assignedStaffId
     ${where}
     ORDER BY l.updatedAt DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);

  auditPhi(req, "list", "leads", undefined, `rows=${(rows as unknown[]).length} total=${total}`);
  return ok({
    data: (rows as LeadRow[]).map((r) => ({ ...r, score: leadScore(r) })),
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

// PATCH /api/leads — {id, status} moves a lead between stages (kanban drag)
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id || (!body?.status && body?.value === undefined)) return bad("id with status or value required");
  if (body.status && !STAGE_KEYS.includes(body.status)) return bad(`status must be one of: ${STAGE_KEYS.join(", ")}`);

  const lead = db.prepare("SELECT id, status FROM leads WHERE id = ?").get(body.id) as { id: string; status: string } | undefined;
  if (!lead) return bad("lead not found", 404);

  // deal-value-only update: {id, value} without a stage change
  if (body.value !== undefined && !body.status) {
    const v = Math.max(0, Math.round(Number(body.value) || 0));
    db.prepare("UPDATE leads SET value = ?, updatedAt = ? WHERE id = ?").run(v, new Date().toISOString(), body.id);
    auditPhi(req, "update", "leads", body.id, "value");
    return ok({ id: body.id, value: v });
  }

  const now = new Date().toISOString();
  // capacity accounting: open→closed releases the owner's slot, closed→open takes it back
  const leadFull = db.prepare("SELECT customerId, status, assignedStaffId FROM leads WHERE id = ?").get(body.id) as { customerId: string; status: string; assignedStaffId: string | null };
  stageTransition(leadFull.status, body.status, leadFull.assignedStaffId ?? (db.prepare("SELECT assignedStaffId FROM customers WHERE id = ?").get(leadFull.customerId) as { assignedStaffId: string | null }).assignedStaffId);
  const hist = JSON.parse((db.prepare("SELECT statusHistory FROM leads WHERE id = ?").get(body.id) as { statusHistory: string }).statusHistory || "[]");
  hist.push({ status: body.status, at: now });

  db.prepare("UPDATE leads SET status = ?, statusHistory = ?, updatedAt = ? WHERE id = ?").run(body.status, JSON.stringify(hist), now, body.id);
  // conversion payload: won amount rides along with the stage move
  if (body.value !== undefined) {
    db.prepare("UPDATE leads SET value = ? WHERE id = ?").run(Math.max(0, Math.round(Number(body.value) || 0)), body.id);
  }
  db.prepare("UPDATE customers SET leadStage = ?, updatedAt = ? WHERE id = (SELECT customerId FROM leads WHERE id = ?)").run(body.status, now, body.id);
  db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(
    `act_${Date.now()}`, (db.prepare("SELECT customerId FROM leads WHERE id = ?").get(body.id) as { customerId: string }).customerId,
    "stage", `Moved ${lead.status} → ${body.status}`, now
  );
  const customerId = (db.prepare("SELECT customerId FROM leads WHERE id = ?").get(body.id) as { customerId: string }).customerId;
  const auto = runStageAutomations(body.status, customerId);
  auditPhi(req, "update", "leads", body.id, `stage ${lead.status} -> ${body.status}`);
  return ok({ id: body.id, status: body.status, automation: auto });
}

// POST /api/leads — new lead (creates customer + lead)
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.name || !b?.phone) return bad("name and phone required");
  const now = new Date().toISOString();
  const cid = `cus_${Date.now().toString(36)}`;
  const lid = `lead_${Date.now().toString(36)}`;
  const stage = STAGE_KEYS.includes(b.stage) ? b.stage : "new";
  const owner = pickOwner();

  db.prepare(
    `INSERT INTO customers (id, customerNumber, name, phone, email, address, city, state, pincode, businessName, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'prospect', 'manual', '[]', ?, ?, 0, 0, ?, ?)`
  ).run(cid, `BZ-C-${Date.now()}`, b.name, b.phone, b.email ?? null, b.address ?? null, b.city ?? null, b.state ?? null, b.pincode ?? null, b.businessName ?? null, owner, stage, now, now);

  db.prepare("INSERT INTO leads (id, customerId, status, source, assignedStaffId, noteCount, activityCount, value, statusHistory, createdAt, updatedAt) VALUES (?,?,?,?,?,0,0,?,?,?,?)")
    .run(lid, cid, stage, "manual", owner, Math.max(0, Math.round(Number(b.value) || 0)), JSON.stringify([{ status: stage, at: now }]), now, now);
  db.prepare("UPDATE customers SET leadStage=? WHERE id=?").run(stage, cid);
  bumpLoad(owner, 1);
  runWorkflows("lead_created", cid);
  auditPhi(req, "create", "leads", lid, `customer=${cid}`);
  return ok({ leadId: lid, customerId: cid, assignedTo: owner });
}
