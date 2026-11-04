import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { normPhone } from "@/lib/phone";
import { pickOwner, bumpLoad } from "@/lib/assign";

// POST /api/customers/import — {rows: [{name, phone, email, city, state, businessName, stage, value}]}
// Bulk CSV import. Duplicate phones (last-10-digits) and rows missing name/phone
// are skipped and reported back row-by-row so the UI can show exactly what happened.
const MAX_ROWS = 500;

type ImportRow = {
  name?: string; phone?: string; email?: string; city?: string; state?: string;
  businessName?: string; stage?: string; value?: string | number;
};

const STAGE_KEYS = new Set(["new", "contacted", "engaged", "qualified", "negotiation", "converted", "on_hold", "unresponsive", "lost", "junk"]);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const rows: ImportRow[] = Array.isArray(b?.rows) ? b.rows : null;
  if (!rows) return bad("rows array required");
  if (rows.length === 0) return bad("no rows to import");
  if (rows.length > MAX_ROWS) return bad(`too many rows — max ${MAX_ROWS} per import`);

  const now = new Date().toISOString();
  const insCustomer = db.prepare(
    `INSERT INTO customers (id, customerNumber, name, phone, email, address, city, state, pincode, businessName, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?, 'manual', '[]', ?, ?, 0, 0, ?, ?)`
  );
  const insLead = db.prepare(
    `INSERT INTO leads (id, customerId, status, source, assignedStaffId, noteCount, activityCount, value, statusHistory, createdAt, updatedAt)
     VALUES (?,?,?,'manual',?,0,0,?,?,?,?)`
  );

  let imported = 0;
  let leads = 0;
  const skipped: Array<{ row: number; name: string; reason: string }> = [];

  // one phone index for the whole batch: existing customers + rows imported in this run
  const phoneIndex = new Map<string, string>();
  for (const c of db.prepare("SELECT id, phone FROM customers WHERE status != 'archived'").all() as Array<{ id: string; phone: string }>) {
    const n = normPhone(c.phone);
    if (n.length === 10) phoneIndex.set(n, c.id);
  }

  db.transaction(() => {
    rows.forEach((r, i) => {
      const rowNo = i + 2; // +1 header row, +1 one-based
      const name = String(r.name ?? "").trim();
      const phone = String(r.phone ?? "").trim();
      if (!name) { skipped.push({ row: rowNo, name, reason: "missing name" }); return; }
      if (!phone) { skipped.push({ row: rowNo, name, reason: "missing phone" }); return; }
      const norm = normPhone(phone);
      if (norm.length !== 10) { skipped.push({ row: rowNo, name, reason: `invalid phone "${phone}"` }); return; }
      if (phoneIndex.has(norm)) { skipped.push({ row: rowNo, name, reason: "duplicate phone — already on file" }); return; }

      const stage = typeof r.stage === "string" && STAGE_KEYS.has(r.stage) ? r.stage : null;
      const owner = stage ? pickOwner() : null;
      const id = `cus_imp_${Date.now().toString(36)}_${i}`;
      insCustomer.run(id, `BZ-C-${Date.now() + i}`, name, phone, r.email?.trim() || null, r.city?.trim() || null, r.state?.trim() || null,
        r.businessName?.trim() || null, "prospect", owner, stage, now, now);
      if (stage) {
        const value = Math.max(0, Math.round(Number(r.value) || 0));
        insLead.run(`lead_imp_${Date.now().toString(36)}_${i}`, id, stage, owner, value,
          JSON.stringify([{ status: stage, at: now }]), now, now);
        bumpLoad(owner, 1);
        leads++;
      }
      phoneIndex.set(norm, id); // intra-batch dupes get caught too
      imported++;
    });
  })();

  auditPhi(req, "import", "customers", undefined, `imported=${imported} skipped=${skipped.length} total=${rows.length}`);
  return ok({ imported, leads, skipped, total: rows.length });
}
