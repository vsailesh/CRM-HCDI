import crypto from "crypto";
import db from "./db";

/**
 * Tamper-evident audit trail. Each row's hash covers its content plus the
 * previous row's hash, so any edit/removal breaks the chain (verifyAuditChain).
 * The table also rejects UPDATE/DELETE via triggers. Never put PHI values in
 * `detail` — log identifiers (resourceId), not content.
 */
export type AuditEvent = {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  outcome?: "success" | "failure" | "denied";
  ip?: string | null;
  detail?: string;
};

const insert = db.prepare(
  `INSERT INTO audit_log (ts, actorId, actorName, action, resource, resourceId, outcome, ip, detail, prevHash, hash)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`
);
const lastHash = db.prepare("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1");

function digest(prev: string, f: unknown[]) {
  return crypto.createHash("sha256").update(prev + "|" + JSON.stringify(f)).digest("hex");
}

export const logAudit = db.transaction((e: AuditEvent) => {
  const prev = (lastHash.get() as { hash: string } | undefined)?.hash ?? "GENESIS";
  const f = [
    new Date().toISOString(), e.actorId ?? null, e.actorName ?? null, e.action, e.resource ?? null,
    e.resourceId ?? null, e.outcome ?? "success", e.ip ?? null, e.detail ?? null,
  ];
  insert.run(...f, prev, digest(prev, f));
});

/** Returns the seq of the first broken row, or null if the chain is intact. */
export function verifyAuditChain(): number | null {
  let prev = "GENESIS";
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as any[];
  for (const r of rows) {
    const f = [r.ts, r.actorId, r.actorName, r.action, r.resource, r.resourceId, r.outcome, r.ip, r.detail];
    if (r.prevHash !== prev || r.hash !== digest(prev, f)) return r.seq;
    prev = r.hash;
  }
  return null;
}

export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}
