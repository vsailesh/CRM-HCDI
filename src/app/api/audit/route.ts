import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit, verifyAuditChain } from "@/lib/audit";

// GET /api/audit?limit&offset&action&actor&resource&outcome&verify=1 — admin only.
// Viewing the audit trail is itself audited.
export async function GET(req: NextRequest) {
  const actor = actorOf(req);
  if (actor?.role !== "admin") return bad("Admin access required", 403);

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50)));
  const offset = Math.max(0, Number(sp.get("offset") ?? 0));

  let where = " WHERE 1=1";
  const params: unknown[] = [];
  const action = sp.get("action");
  if (action) { where += " AND action LIKE ?"; params.push(`${action}%`); } // "phi" matches phi.read, phi.list…
  const who = sp.get("actor");
  if (who) { where += " AND actorId = ?"; params.push(who); }
  const resource = sp.get("resource");
  if (resource) { where += " AND resource = ?"; params.push(resource); }
  const resourceId = sp.get("resourceId");
  if (resourceId) { where += " AND resourceId = ?"; params.push(resourceId); }
  const outcome = sp.get("outcome");
  if (outcome) { where += " AND outcome = ?"; params.push(outcome); }

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT seq, ts, actorId, actorName, action, resource, resourceId, outcome, ip, detail
     FROM audit_log${where} ORDER BY seq DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const chainBrokenAt = sp.get("verify") === "1" ? verifyAuditChain() : undefined;
  logAudit({ actorId: actor.sub, actorName: actor.name, action: "audit.view", ip: clientIp(req), detail: `rows=${(rows as unknown[]).length}${chainBrokenAt !== undefined ? " verify" : ""}` });
  return ok({ data: rows, meta: { limit, offset, total }, ...(chainBrokenAt !== undefined ? { chain: { intact: chainBrokenAt === null, brokenAtSeq: chainBrokenAt } } : {}) });
}
