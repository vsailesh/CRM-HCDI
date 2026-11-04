import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { rulesWhere, hasAnyRule, type SegRules } from "@/lib/segment-rules";

// POST /api/segments/preview — live count for a rules object (builder preview)
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const rules = (b?.rules ?? null) as SegRules | null;
  if (!rules || !hasAnyRule(rules)) return bad("at least one rule required");
  const w = rulesWhere(rules)!;
  const count = (db.prepare(`SELECT COUNT(*) AS n FROM customers c${w.where}`).get(...w.params) as { n: number }).n;
  const sample = db.prepare(
    `SELECT c.id, c.name, c.phone FROM customers c${w.where} ORDER BY c.updatedAt DESC LIMIT 5`
  ).all(...w.params) as Array<{ id: string; name: string; phone: string }>;
  auditPhi(req, "list", "customers", undefined, `segment-preview count=${count} sample=${sample.length}`);
  return ok({ count, sample });
}
