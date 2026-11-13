import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { getBatch } from "@/lib/history";
import { rollbackBatch } from "@/lib/importer";

type Ctx = { params: Promise<{ id: string }> };

// POST — roll the batch back (admin). Fields changed by anyone since are left alone and counted.
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const { id } = await ctx.params;
  const b = getBatch(id);
  if (!b) return bad("Batch not found", 404);
  const r = rollbackBatch(id, { id: a.sub });
  if ("error" in r) return bad(r.error, 409);
  logAudit({ actorId: a.sub, actorName: a.name, action: "phi.rollback", resource: b.object, resourceId: id, ip: clientIp(req),
    detail: `deleted=${r.deleted} restored=${r.restored} conflicts=${r.skippedConflict} blocked=${r.blocked}` });
  return ok(r, "Rolled back");
}
