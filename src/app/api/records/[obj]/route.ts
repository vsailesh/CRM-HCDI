import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getObject } from "@/lib/meta";
import { createRecord, listRecords, type Filter } from "@/lib/records";
import { caseAfterCreate, caseBeforeCreate } from "@/lib/case-automation";

type Ctx = { params: Promise<{ obj: string }> };

export function parseFilters(raw: string | null): Filter[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((f) => f && typeof f.field === "string" && typeof f.op === "string") : [];
  } catch { return []; }
}

// GET /api/records/:obj?q&filters=[{field,op,value}]&owner=me&sort&dir&limit&offset
export async function GET(req: NextRequest, ctx: Ctx) {
  const { obj } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const a = actorOf(req);
  const sp = req.nextUrl.searchParams;
  const { rows, total } = listRecords(obj, {
    filters: parseFilters(sp.get("filters")), q: sp.get("q") ?? undefined,
    ownerId: sp.get("owner") === "me" ? a?.sub : undefined,
    sort: sp.get("sort") ?? undefined, dir: sp.get("dir") ?? undefined,
    limit: Number(sp.get("limit") ?? 25), offset: Number(sp.get("offset") ?? 0),
  });
  if (o.phi) auditPhi(req, "list", obj, undefined, `rows=${rows.length}`); // ids/counts only, never search terms
  return ok({ data: rows, meta: { total } });
}

// POST /api/records/:obj { values:{...}, ownerId? }
export async function POST(req: NextRequest, ctx: Ctx) {
  const { obj } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const a = actorOf(req);
  const b = await req.json().catch(() => ({}));
  // Case assignment rules + SLA due date (explicit owner / due date always win)
  const pre = obj === "case" ? caseBeforeCreate(b.values ?? {}, b.ownerId, a?.sub ?? null) : null;
  const r = createRecord(obj, pre?.values ?? b.values ?? {}, a?.sub ?? null, pre ? pre.ownerId : b.ownerId);
  if (r.errors.length) return bad(r.errors.join("; "), 422);
  if (pre && r.id) caseAfterCreate(r.id, pre.notes);
  if (o.phi) auditPhi(req, "create", obj, r.id);
  return ok({ id: r.id }, "Created");
}
