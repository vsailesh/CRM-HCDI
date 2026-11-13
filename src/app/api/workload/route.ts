import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { applyAssignment, planAssignment, teamLoad, type PlanSpec } from "@/lib/workload";

// GET — current caseload per team member (admin: it is a manager view)
export async function GET(req: NextRequest) {
  if (actorOf(req)?.role !== "admin") return bad("Admin access required", 403);
  return ok(teamLoad());
}

// POST { fromOwner|null, statuses, pool, languagePools?, apply? } — preview by default; apply:true writes one undoable batch
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const b = await req.json().catch(() => ({}));
  if (!Array.isArray(b.pool) || b.pool.length === 0) return bad("Choose at least one team member to receive cases");
  const spec: PlanSpec = {
    fromOwner: b.fromOwner || null, statuses: Array.isArray(b.statuses) ? b.statuses.map(String) : ["New"],
    pool: b.pool.map(String), languagePools: b.languagePools && typeof b.languagePools === "object" ? b.languagePools : undefined,
  };
  const plan = planAssignment(spec);
  if (!b.apply) return ok({ ...plan, moves: undefined, moveCount: plan.moves.length });
  const r = applyAssignment(plan, { id: a.sub, name: a.name }, "Caseload rebalance");
  logAudit({ actorId: a.sub, actorName: a.name, action: "phi.update", resource: "case", resourceId: r.batchId, ip: clientIp(req), detail: `rebalance assigned=${r.assigned} failed=${r.failed}` });
  return ok({ ...plan, moves: undefined, moveCount: plan.moves.length, applied: r }, "Assigned");
}
