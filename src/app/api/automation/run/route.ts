import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { runCaseSweep } from "@/lib/case-automation";

// POST /api/automation/run — admin triggers the SLA sweep immediately (it also runs every 10 min)
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const r = runCaseSweep();
  logAudit({ actorId: a.sub, actorName: a.name, action: "automation.sweep.manual", resource: "case", ip: clientIp(req), detail: `checked=${r.checked} warned=${r.warned} escalated=${r.escalated}` });
  return ok(r, "Sweep complete");
}
