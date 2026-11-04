import { actorOf } from "./api";
import { clientIp, logAudit } from "./audit";

/**
 * PHI access logging (HIPAA §164.312(b), §164.308(a)(1)(ii)(D)).
 * Call from any route that reads or changes member/customer data. Logs WHO did
 * WHAT to WHICH record — identifiers and counts only, never field values or
 * search terms (those can themselves be PHI).
 *
 * `read`   one record opened         `list`   many records returned
 * `create` / `update` / `merge` / `import` — writes
 */
export type PhiAction = "read" | "list" | "create" | "update" | "merge" | "import" | "export";

export function auditPhi(req: Request, action: PhiAction, resource: string, resourceId?: string, detail?: string) {
  const a = actorOf(req);
  logAudit({
    actorId: a?.sub ?? null,
    actorName: a?.name ?? null,
    action: `phi.${action}`,
    resource,
    resourceId,
    ip: clientIp(req),
    detail,
  });
}
