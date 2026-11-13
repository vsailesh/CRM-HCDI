import db from "./db";
import { newId } from "./meta";
import { updateRecord } from "./records";
import { saveBatch, type Undo } from "./history";

/**
 * Caseload balancing — spreads cases held by one owner (usually the default / unassigned bucket) across a team.
 *   - balances each person's TOTAL open caseload, not just the new cases
 *   - cases in the same household stay together on one person
 *   - language pools: a language can be reserved for specific staff (e.g. Spanish speakers)
 * plan() is read-only; apply() writes one undoable batch.
 */
export type Plan = {
  staff: Array<{ id: string; name: string; before: number; added: number; after: number }>;
  moves: Array<{ caseId: string; to: string }>;
  candidates: number; households: number; unplaceable: number;
};
export type PlanSpec = {
  fromOwner: string | null;                 // staff id, or null for cases with no owner
  statuses: string[];
  pool: string[];                           // staff ids eligible to receive cases
  languagePools?: Record<string, string[]>; // memberLanguage value -> staff ids (restricts that language to them)
};
const OPEN_LOAD = `SELECT ownerId, COUNT(*) n FROM srecords WHERE object = 'case' AND COALESCE(json_extract(data,'$.status'),'') != 'Closed' GROUP BY ownerId`;

export function teamLoad() {
  const load = new Map((db.prepare(OPEN_LOAD).all() as { ownerId: string | null; n: number }[]).map((r) => [r.ownerId, r.n]));
  const overdue = new Map((db.prepare(`SELECT ownerId, COUNT(*) n FROM srecords WHERE object = 'case' AND COALESCE(json_extract(data,'$.status'),'') != 'Closed'
    AND json_extract(data,'$.dueDate') < date('now') GROUP BY ownerId`).all() as { ownerId: string | null; n: number }[]).map((r) => [r.ownerId, r.n]));
  const fresh = new Map((db.prepare(`SELECT ownerId, COUNT(*) n FROM srecords WHERE object = 'case' AND json_extract(data,'$.status') = 'New' GROUP BY ownerId`).all() as { ownerId: string | null; n: number }[]).map((r) => [r.ownerId, r.n]));
  const staff = db.prepare("SELECT id,name,isAvailable FROM staff WHERE isActive = 1 ORDER BY name").all() as { id: string; name: string; isAvailable: number }[];
  return {
    staff: staff.map((s) => ({ id: s.id, name: s.name, available: !!s.isAvailable, open: load.get(s.id) ?? 0, overdue: overdue.get(s.id) ?? 0, untouched: fresh.get(s.id) ?? 0 })),
    unassigned: { open: load.get(null) ?? 0, untouched: fresh.get(null) ?? 0 },
  };
}

export function planAssignment(spec: PlanSpec): Plan {
  const pool = [...new Set(spec.pool)];
  const names = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const load = new Map<string, number>(pool.map((id) => [id, 0]));
  for (const r of db.prepare(OPEN_LOAD).all() as { ownerId: string | null; n: number }[]) if (r.ownerId && load.has(r.ownerId)) load.set(r.ownerId, r.n);
  const before = new Map(load);

  const statuses = spec.statuses.length ? spec.statuses : ["New"];
  const rows = db.prepare(`SELECT id, data FROM srecords WHERE object = 'case' AND ${spec.fromOwner ? "ownerId = ?" : "ownerId IS NULL"}
    AND COALESCE(json_extract(data,'$.status'),'') IN (${statuses.map(() => "?").join(",")})`).all(...(spec.fromOwner ? [spec.fromOwner] : []), ...statuses) as { id: string; data: string }[];

  // keep households together: a group is every candidate case sharing a household (or the case on its own)
  const groups = new Map<string, { ids: string[]; lang: string | null }>();
  for (const r of rows) {
    const d = JSON.parse(r.data) as { household?: string; memberLanguage?: string };
    const key = d.household ? `h:${d.household}` : `c:${r.id}`;
    const g = groups.get(key) ?? groups.set(key, { ids: [], lang: null }).get(key)!;
    g.ids.push(r.id);
    if (!g.lang && d.memberLanguage && spec.languagePools?.[d.memberLanguage]) g.lang = d.memberLanguage;
  }

  const moves: Plan["moves"] = [];
  let unplaceable = 0;
  for (const g of [...groups.values()].sort((a, b) => b.ids.length - a.ids.length)) {
    const options = g.lang ? spec.languagePools![g.lang].filter((id) => load.has(id)) : pool;
    if (!options.length) { unplaceable += g.ids.length; continue; }
    const pick = options.reduce((best, id) => ((load.get(id)! < load.get(best)!) || (load.get(id) === load.get(best) && id < best) ? id : best));
    for (const id of g.ids) moves.push({ caseId: id, to: pick });
    load.set(pick, load.get(pick)! + g.ids.length);
  }
  return {
    staff: pool.map((id) => ({ id, name: names.get(id) ?? id, before: before.get(id) ?? 0, added: moves.filter((m) => m.to === id).length, after: load.get(id) ?? 0 })),
    moves, candidates: rows.length, households: [...groups.keys()].filter((k) => k.startsWith("h:")).length, unplaceable,
  };
}

export function applyAssignment(plan: Plan, actor: { id: string; name: string }, label: string) {
  const batchId = newId("batch");
  const undo: Undo = { created: [], updated: [] };
  let failed = 0;
  db.transaction(() => {
    for (const m of plan.moves) {
      const cur = db.prepare("SELECT ownerId FROM srecords WHERE id = ?").get(m.caseId) as { ownerId: string | null } | undefined;
      if (!cur || cur.ownerId === m.to) continue;
      const r = updateRecord("case", m.caseId, {}, m.to, undefined, { actorId: actor.id, source: "bulk", batchId });
      if (r.errors.length) { failed++; continue; }
      undo.updated.push({ id: m.caseId, changes: {}, ownerOld: cur.ownerId, ownerNew: m.to });
    }
    saveBatch({ id: batchId, kind: "assignment", object: "case", label, createdBy: actor.id, createdByName: actor.name,
      summary: { matched: plan.moves.length, updated: undo.updated.length, failed, unchanged: plan.moves.length - undo.updated.length - failed } }, undo);
  })();
  return { batchId, assigned: undo.updated.length, failed };
}
