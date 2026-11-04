import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { getAssignConfig, getSlaConfig, recentLog, saveConfig } from "@/lib/case-automation";

// GET /api/automation — admin: current rules, team list, recent automation activity
export async function GET(req: NextRequest) {
  if (actorOf(req)?.role !== "admin") return bad("Admin access required", 403);
  const staff = db.prepare("SELECT id, name, isAvailable FROM staff WHERE isActive = 1 ORDER BY name").all();
  return ok({ assignment: getAssignConfig(), sla: getSlaConfig(), staff, log: recentLog(40) });
}

// PUT { assignment, sla } — admin saves rules (validated server-side)
export async function PUT(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const b = await req.json().catch(() => ({}));
  if (!b.assignment || !b.sla) return bad("assignment and sla are required");
  const err = saveConfig(b.assignment, b.sla);
  if (err) return bad(err, 422);
  logAudit({ actorId: a.sub, actorName: a.name, action: "automation.config.update", resource: "case", ip: clientIp(req) });
  return ok({}, "Saved");
}
