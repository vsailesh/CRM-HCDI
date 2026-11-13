import db from "./db";
import type { SField } from "./meta";

/**
 * Field-level change history (Salesforce "Field History Tracking") and undoable batches.
 *   field_history  one row per field change: who, when, from where (user / import / bulk / rollback / automation)
 *   bulk_batches   one row per import or bulk update, holding exactly what is needed to undo it
 * Values are PHI. They are only read back through routes that apply record access and field security,
 * and are never written to the audit log.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS field_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recordId TEXT NOT NULL, object TEXT NOT NULL, field TEXT NOT NULL,
  oldValue TEXT, newValue TEXT, changedAt TEXT NOT NULL, changedBy TEXT, source TEXT NOT NULL DEFAULT 'user', batchId TEXT
);
CREATE INDEX IF NOT EXISTS idx_fh_rec ON field_history(recordId, id);
CREATE INDEX IF NOT EXISTS idx_fh_batch ON field_history(batchId);
CREATE TABLE IF NOT EXISTS bulk_batches (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, object TEXT NOT NULL, label TEXT, createdBy TEXT, createdByName TEXT, createdAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied', summary TEXT NOT NULL DEFAULT '{}', undo TEXT NOT NULL DEFAULT '{}', rolledBackAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_at ON bulk_batches(createdAt);
`);

export type ChangeSource = "user" | "import" | "bulk" | "rollback" | "automation";
export type Ctx = { actorId?: string | null; source?: ChangeSource; batchId?: string | null };

const enc = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v).slice(0, 1000));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const ins = db.prepare(`INSERT INTO field_history (recordId,object,field,oldValue,newValue,changedAt,changedBy,source,batchId) VALUES (?,?,?,?,?,?,?,?,?)`);

/** Log every tracked field whose value differs between `before` and `after`. Returns the changed api names. */
export function logFieldChanges(object: string, recordId: string, fields: SField[], before: Record<string, unknown>, after: Record<string, unknown>, ctx: Ctx = {}): string[] {
  const now = new Date().toISOString();
  const changed: string[] = [];
  for (const f of fields) {
    if (f.type === "autonumber") continue;
    if (same(before[f.api], after[f.api])) continue;
    changed.push(f.api);
    ins.run(recordId, object, f.api, enc(before[f.api]), enc(after[f.api]), now, ctx.actorId ?? null, ctx.source ?? "user", ctx.batchId ?? null);
  }
  return changed;
}

/** Fields a person last edited by hand — an import must not overwrite these when "protect edits" is on. */
export function humanEditedFields(recordId: string): Set<string> {
  const rows = db.prepare(`SELECT field, source FROM field_history WHERE id IN (SELECT MAX(id) FROM field_history WHERE recordId = ? GROUP BY field)`).all(recordId) as { field: string; source: string }[];
  return new Set(rows.filter((r) => r.source === "user").map((r) => r.field));
}

export type HistoryRow = { id: number; field: string; oldValue: unknown; newValue: unknown; changedAt: string; changedBy: string | null; changedByName: string | null; source: string };

export function historyFor(recordId: string, limit = 200): HistoryRow[] {
  const staff = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const parse = (s: string | null) => { try { return s == null ? null : JSON.parse(s); } catch { return s; } };
  return (db.prepare("SELECT * FROM field_history WHERE recordId = ? ORDER BY id DESC LIMIT ?").all(recordId, limit) as Array<Record<string, string | number | null>>)
    .map((r) => ({ id: r.id as number, field: r.field as string, oldValue: parse(r.oldValue as string | null), newValue: parse(r.newValue as string | null),
      changedAt: r.changedAt as string, changedBy: r.changedBy as string | null, changedByName: r.changedBy ? staff.get(r.changedBy as string) ?? null : r.source === "automation" ? "Automation" : null, source: r.source as string }));
}

export type Batch = {
  id: string; kind: "import" | "bulk" | "assignment"; object: string; label: string | null; createdBy: string | null; createdByName: string | null;
  createdAt: string; status: "applied" | "rolled_back"; summary: Record<string, unknown>; rolledBackAt: string | null;
};
export type Undo = {
  created: string[];
  updated: Array<{ id: string; changes: Record<string, { old: unknown; new: unknown }>; ownerOld?: string | null; ownerNew?: string | null }>;
};

export function saveBatch(b: Omit<Batch, "createdAt" | "status" | "rolledBackAt">, undo: Undo) {
  db.prepare(`INSERT INTO bulk_batches (id,kind,object,label,createdBy,createdByName,createdAt,status,summary,undo) VALUES (?,?,?,?,?,?,?, 'applied', ?, ?)`)
    .run(b.id, b.kind, b.object, b.label, b.createdBy, b.createdByName, new Date().toISOString(), JSON.stringify(b.summary), JSON.stringify(undo));
}

export function listBatches(limit = 100): Batch[] {
  return (db.prepare("SELECT id,kind,object,label,createdBy,createdByName,createdAt,status,summary,rolledBackAt FROM bulk_batches ORDER BY createdAt DESC LIMIT ?").all(limit) as Array<Record<string, string | null>>)
    .map((r) => ({ ...(r as unknown as Batch), summary: JSON.parse(r.summary ?? "{}") }));
}
export function getBatch(id: string): (Batch & { undo: Undo }) | null {
  const r = db.prepare("SELECT * FROM bulk_batches WHERE id = ?").get(id) as Record<string, string | null> | undefined;
  return r ? ({ ...(r as unknown as Batch), summary: JSON.parse(r.summary ?? "{}"), undo: JSON.parse(r.undo ?? "{}") } as Batch & { undo: Undo }) : null;
}
export function markRolledBack(id: string) {
  db.prepare("UPDATE bulk_batches SET status = 'rolled_back', rolledBackAt = ? WHERE id = ?").run(new Date().toISOString(), id);
}
