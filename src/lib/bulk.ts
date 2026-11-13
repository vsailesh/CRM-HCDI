import db from "./db";
import { getFields, getObject, newId } from "./meta";
import { buildWhere, updateRecord, type Filter } from "./records";
import { saveBatch, type Undo } from "./history";

/**
 * Bulk update by filter — "close every overdue case", "move this CHW's New cases to someone else".
 * Dry run executes the real updates inside a transaction that is rolled back, so the preview is exact.
 * Applied runs are batches and can be rolled back from the Batches page.
 */
export type BulkSpec = { object: string; filters: Filter[]; set: Record<string, unknown>; ownerId?: string | null; dryRun: boolean; label?: string };
export type BulkResult = { dryRun: boolean; batchId: string | null; matched: number; updated: number; unchanged: number; failed: number; errors: string[]; truncated: boolean };
export const BULK_MAX = 5000;
class Abort extends Error {}

export function runBulkUpdate(spec: BulkSpec, actor: { id: string; name: string }): BulkResult {
  const obj = getObject(spec.object);
  if (!obj) throw new Error("Unknown object");
  const fields = getFields(spec.object);
  const apis = new Set(fields.map((f) => f.api));
  for (const k of Object.keys(spec.set)) if (!apis.has(k)) throw new Error(`Unknown field: ${k}`);
  if (!Object.keys(spec.set).length && spec.ownerId === undefined) throw new Error("Choose at least one change");
  if (!spec.filters.length) throw new Error("Add at least one filter — a bulk update cannot target every record");

  const w = buildWhere(spec.object, fields, spec.filters);
  const ids = (db.prepare(`SELECT id, ownerId, data FROM srecords WHERE ${w.sql} LIMIT ?`).all(...w.params, BULK_MAX + 1)) as { id: string; ownerId: string | null; data: string }[];
  if (ids.length > BULK_MAX) throw new Error(`That matches more than ${BULK_MAX} records — narrow the filters`);

  const res: BulkResult = { dryRun: spec.dryRun, batchId: null, matched: ids.length, updated: 0, unchanged: 0, failed: 0, errors: [], truncated: false };
  const undo: Undo = { created: [], updated: [] };
  const batchId = newId("batch");

  const work = db.transaction(() => {
    for (const r of ids) {
      const before = JSON.parse(r.data) as Record<string, unknown>;
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(spec.set)) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) changes[k] = v;
      const newOwner = spec.ownerId !== undefined && (spec.ownerId || null) !== r.ownerId ? spec.ownerId : undefined;
      if (!Object.keys(changes).length && newOwner === undefined) { res.unchanged++; continue; }
      const u = updateRecord(spec.object, r.id, changes, newOwner, undefined, { actorId: actor.id, source: "bulk", batchId });
      if (u.errors.length) { res.failed++; if (res.errors.length < 20) res.errors.push(u.errors.join("; ").replace(/"[^"]*"/g, '"…"')); else res.truncated = true; continue; }
      const after = JSON.parse((db.prepare("SELECT data FROM srecords WHERE id = ?").get(r.id) as { data: string }).data) as Record<string, unknown>;
      const diff: Record<string, { old: unknown; new: unknown }> = {};
      for (const api of u.changed ?? []) diff[api] = { old: before[api] ?? null, new: after[api] ?? null };
      undo.updated.push({ id: r.id, changes: diff, ...(newOwner !== undefined ? { ownerOld: r.ownerId, ownerNew: newOwner } : {}) });
      res.updated++;
    }
    if (spec.dryRun) throw new Abort();
    res.batchId = batchId;
    saveBatch({ id: batchId, kind: "bulk", object: spec.object, label: spec.label ?? null, createdBy: actor.id, createdByName: actor.name,
      summary: { matched: res.matched, updated: res.updated, unchanged: res.unchanged, failed: res.failed, fields: Object.keys(spec.set), reassigned: spec.ownerId !== undefined } }, undo);
  });
  try { work(); } catch (e) { if (!(e instanceof Abort)) throw e; }
  return res;
}
