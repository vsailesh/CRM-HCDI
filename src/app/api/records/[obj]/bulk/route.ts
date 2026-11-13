import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getObject } from "@/lib/meta";
import { runBulkUpdate } from "@/lib/bulk";

type Ctx = { params: Promise<{ obj: string }> };

// POST { filters:[{field,op,value}], set:{field:value}, ownerId?, dryRun?, label? } — admin only.
// dryRun defaults to true: nothing is written until the caller sends dryRun:false.
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required for bulk updates", 403);
  const { obj } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const b = await req.json().catch(() => ({}));
  const filters = Array.isArray(b.filters) ? b.filters.filter((f: { field?: unknown; op?: unknown }) => f && typeof f.field === "string" && typeof f.op === "string") : [];
  try {
    const r = runBulkUpdate({
      object: obj, filters, set: b.set && typeof b.set === "object" ? b.set : {},
      ownerId: b.ownerId === undefined ? undefined : b.ownerId || null, dryRun: b.dryRun !== false, label: typeof b.label === "string" ? b.label.slice(0, 60) : undefined,
    }, { id: a.sub, name: a.name });
    if (!r.dryRun && o.phi) auditPhi(req, "update", obj, r.batchId ?? undefined, `bulk updated=${r.updated} failed=${r.failed}`);
    return ok(r);
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}
