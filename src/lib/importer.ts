import db from "./db";
import { getFields, getObject, newId, type SField } from "./meta";
import { cascadeCaseOwner, computeName, createRecord, updateRecord, deleteRecord } from "./records";
import { caseAfterCreate, caseBeforeCreate } from "./case-automation";
import { getBatch, humanEditedFields, markRolledBack, saveBatch, logFieldChanges, type Undo } from "./history";
import { canonKey, firstPhone, looksLikeDob, normBool, normDate, normLanguage, normState, normZip } from "./normalize";

/**
 * Generic upsert import — the CRM side of the SQL → Salesforce writer.
 *   - rows are matched to existing records on a key field (member id, NPI, external id…)
 *   - values are cleaned (phone, ZIP, state, date incl. DOB century fix, language, yes/no)
 *   - update policy decides what an import may touch:
 *       overwrite     file wins
 *       fill_blank    only fills fields that are empty (never overwrites)
 *       protect_edits overwrites, except a field a person last edited by hand
 *   - a dry run executes the real code path inside a transaction that is rolled back, so the preview is exact
 *   - an applied import is a batch that can be rolled back (a field is only restored if nobody changed it since)
 * Error messages never contain cell values (they are PHI); only row numbers and field names.
 */

export const MAX_ROWS = 5000;
export type UpdatePolicy = "overwrite" | "fill_blank" | "protect_edits";
export type ImportMode = "upsert" | "create_only" | "update_only";

export type ImportSpec = {
  object: string;
  rows: Record<string, string>[];
  mapping: Record<string, string>;            // file column -> field api, "@owner" (staff name/email) or "@name" (record name)
  matchField?: string;                         // field api (or "@name") used to find an existing record
  mode: ImportMode;
  updatePolicy: UpdatePolicy;
  lookupKeys?: Record<string, string>;         // lookup field api -> field api on the target used to find it (default: record name)
  autoCreateLookups?: boolean;
  dryRun: boolean;
  label?: string;
};
export type RowError = { row: number; message: string };
export type ImportResult = {
  dryRun: boolean; batchId: string | null; rows: number; created: number; updated: number; unchanged: number;
  skippedProtected: number; skippedFilled: number; lookupsCreated: number; failed: number;
  fieldUpdates: Record<string, number>; cleaned: Record<string, number>; errors: RowError[]; errorsTruncated: boolean;
};

class Abort extends Error {}
const clean = (m: string) => m.replace(/"[^"]*"/g, '"…"'); // never echo a value
const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

type Staff = { id: string; name: string; email: string | null };
function staffIndex() {
  const rows = db.prepare("SELECT id,name,email FROM staff WHERE isActive = 1").all() as Staff[];
  const m = new Map<string, string>();
  for (const s of rows) { m.set(canonKey(s.name), s.id); if (s.email) m.set(canonKey(s.email), s.id); }
  return m;
}

/** Map of canonical key -> record id for one object; null value marks a key that is ambiguous. */
function buildIndex(object: string, keyField: string): Map<string, string | null> {
  const idx = new Map<string, string | null>();
  const rows = db.prepare("SELECT id,name,data FROM srecords WHERE object = ?").all(object) as { id: string; name: string; data: string }[];
  for (const r of rows) {
    const raw = keyField === "@name" ? r.name : (JSON.parse(r.data) as Record<string, unknown>)[keyField];
    const k = canonKey(raw);
    if (!k) continue;
    idx.set(k, idx.has(k) ? null : r.id);
  }
  return idx;
}

type Clean = { v: unknown; err?: string; fixed?: boolean };
/** Clean one raw cell for a field. `fixed` is true when the cleaned value differs from what was typed. */
function cleanValue(f: SField, raw: string): Clean {
  const s = (raw ?? "").trim();
  if (s === "") return { v: null };
  const out = (v: unknown, err?: string): Clean => ({ v, err, fixed: v != null && String(v) !== s });
  switch (f.type) {
    case "phone": { const p = firstPhone(s); return p ? out(p) : { v: null, err: `${f.label} is not a valid 10-digit phone` }; }
    case "date": { const d = normDate(s, { dob: looksLikeDob(f.api) }); return d ? out(d) : { v: null, err: `${f.label} is not a valid date` }; }
    case "datetime": { const t = Date.parse(s); return Number.isNaN(t) ? { v: null, err: `${f.label} is not a valid date/time` } : out(new Date(t).toISOString().slice(0, 16)); }
    case "checkbox": { const b = normBool(s); return b == null ? { v: null, err: `${f.label} must be yes/no` } : { v: b }; }
    case "number": case "currency": case "percent": return { v: s.replace(/[$,%\s,]/g, "") };
    case "picklist": {
      if (f.api === "memberLanguage" || f.api === "preferredLanguage" || f.api === "languageUsed") {
        const l = normLanguage(s);
        const hit = f.options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? (f.options.includes(l) ? l : undefined);
        if (hit) return out(hit);
      }
      const hit = f.options.find((o) => canonKey(o) === canonKey(s));
      return hit ? out(hit) : { v: s }; // coerce() rejects with the allowed list
    }
    case "multipicklist": {
      const parts = s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      return { v: parts.map((p) => f.options.find((o) => canonKey(o) === canonKey(p)) ?? p) };
    }
    default: {
      if (f.api === "state" || /(^|_)state$/i.test(f.api)) { const st = normState(s); return st ? out(st) : { v: null, err: `${f.label} is not a 2-letter state` }; }
      if (/zip|postal/i.test(f.api)) { const z = normZip(s); return z ? out(z) : { v: null, err: `${f.label} is not a valid ZIP` }; }
      return { v: s };
    }
  }
}

export function runImport(spec: ImportSpec, actor: { id: string; name: string }): ImportResult {
  const obj = getObject(spec.object);
  if (!obj) throw new Error("Unknown object");
  if (spec.rows.length === 0) throw new Error("The file has no rows");
  if (spec.rows.length > MAX_ROWS) throw new Error(`Too many rows — max ${MAX_ROWS} per import`);
  const fields = getFields(spec.object);
  const byApi = new Map(fields.map((f) => [f.api, f]));
  const mapped = Object.entries(spec.mapping).filter(([, t]) => t);
  for (const [, t] of mapped) {
    if (t === "@owner" || t === "@name") continue;
    const f = byApi.get(t);
    if (!f) throw new Error(`Unknown field: ${t}`);
    if (f.type === "autonumber") throw new Error(`${f.label} is generated automatically and cannot be imported`);
  }
  if (new Set(mapped.map(([, t]) => t)).size !== mapped.length) throw new Error("Two columns are mapped to the same field");
  if (spec.matchField && spec.matchField !== "@name" && !byApi.has(spec.matchField)) throw new Error("Unknown match field");
  if (spec.matchField && !mapped.some(([, t]) => t === spec.matchField)) throw new Error("The match field must be one of the mapped columns");
  if (spec.mode === "update_only" && !spec.matchField) throw new Error("Choose a match field to update existing records");

  const res: ImportResult = { dryRun: spec.dryRun, batchId: null, rows: spec.rows.length, created: 0, updated: 0, unchanged: 0, skippedProtected: 0,
    skippedFilled: 0, lookupsCreated: 0, failed: 0, fieldUpdates: {}, cleaned: {}, errors: [], errorsTruncated: false };
  const fail = (row: number, message: string) => { res.failed++; if (res.errors.length < 200) res.errors.push({ row, message: clean(message) }); else res.errorsTruncated = true; };
  const undo: Undo = { created: [], updated: [] };
  const batchId = newId("batch");

  const staff = staffIndex();
  const existing = spec.matchField ? buildIndex(spec.object, spec.matchField) : null;
  const seen = new Set<string>();
  const lookupIdx = new Map<string, Map<string, string | null>>();
  const lookupFor = (f: SField) => {
    const key = spec.lookupKeys?.[f.api] || "@name";
    const k = `${f.ref}|${key}`;
    if (!lookupIdx.has(k)) lookupIdx.set(k, buildIndex(f.ref!, key));
    return { idx: lookupIdx.get(k)!, key };
  };

  const work = db.transaction(() => {
    spec.rows.forEach((rawRow, i) => {
      const rowNo = i + 2; // header is row 1
      const input: Record<string, unknown> = {};
      let ownerId: string | undefined, nameOverride: string | undefined;
      const errs: string[] = [];

      for (const [col, target] of mapped) {
        const cell = rawRow[col] ?? "";
        if (target === "@owner") { if (cell.trim()) { const o = staff.get(canonKey(cell)); if (o) ownerId = o; else errs.push("Owner not found among active staff"); } continue; }
        if (target === "@name") { nameOverride = cell.trim(); continue; }
        const f = byApi.get(target)!;
        if (f.type === "lookup") {
          const s = cell.trim(); if (!s) continue;
          if (/^rec_/.test(s)) { input[f.api] = s; continue; }
          const { idx, key } = lookupFor(f);
          const hit = idx.get(canonKey(s));
          if (hit) input[f.api] = hit;
          else if (hit === null) errs.push(`${f.label}: more than one ${f.ref} matches`);
          else if (spec.autoCreateLookups && key !== "@name") {
            const made = createRecord(f.ref!, { [key]: s }, actor.id, undefined, undefined);
            if (made.errors.length || !made.id) errs.push(`${f.label}: could not create the missing ${f.ref} (${clean(made.errors.join("; "))})`);
            else { input[f.api] = made.id; idx.set(canonKey(s), made.id); undo.created.push(made.id); res.lookupsCreated++; }
          } else errs.push(`${f.label}: no matching ${f.ref} found`);
          continue;
        }
        const c = cleanValue(f, cell);
        if (c.err) { errs.push(c.err); continue; }
        if (c.v === null && cell.trim() === "") continue; // blank cell = leave the field alone
        input[f.api] = c.v;
        if (c.fixed) res.cleaned[f.api] = (res.cleaned[f.api] ?? 0) + 1;
      }
      if (errs.length) return fail(rowNo, errs.join("; "));

      // ── match ──
      let matchId: string | null = null;
      if (spec.matchField) {
        const keyRaw = spec.matchField === "@name" ? nameOverride : input[spec.matchField];
        const k = canonKey(keyRaw);
        if (!k) return fail(rowNo, "Match field is blank");
        if (seen.has(k)) return fail(rowNo, "Duplicate key earlier in this file");
        seen.add(k);
        const hit = existing!.get(k);
        if (hit === null) return fail(rowNo, "More than one existing record has this key");
        matchId = hit ?? null;
      }

      if (matchId) {
        if (spec.mode === "create_only") { res.unchanged++; return; }
        const cur = db.prepare("SELECT data, ownerId FROM srecords WHERE id = ?").get(matchId) as { data: string; ownerId: string | null };
        const before = JSON.parse(cur.data) as Record<string, unknown>;
        const edited = spec.updatePolicy === "protect_edits" ? humanEditedFields(matchId) : null;
        const changes: Record<string, unknown> = {};
        for (const [api, v] of Object.entries(input)) {
          if (JSON.stringify(before[api] ?? null) === JSON.stringify(v ?? null)) continue;
          if (spec.updatePolicy === "fill_blank" && !isEmpty(before[api])) { res.skippedFilled++; continue; }
          if (edited && !isEmpty(before[api]) && edited.has(api)) { res.skippedProtected++; continue; }
          changes[api] = v;
        }
        const newOwner = ownerId && ownerId !== cur.ownerId && spec.updatePolicy !== "fill_blank" ? ownerId : undefined;
        if (!Object.keys(changes).length && newOwner === undefined) { res.unchanged++; return; }
        const r = updateRecord(spec.object, matchId, changes, newOwner, undefined, { actorId: actor.id, source: "import", batchId });
        if (r.errors.length) return fail(rowNo, r.errors.join("; "));
        const diff: Record<string, { old: unknown; new: unknown }> = {};
        const after = JSON.parse((db.prepare("SELECT data FROM srecords WHERE id = ?").get(matchId) as { data: string }).data) as Record<string, unknown>;
        for (const api of r.changed ?? []) { diff[api] = { old: before[api] ?? null, new: after[api] ?? null }; res.fieldUpdates[api] = (res.fieldUpdates[api] ?? 0) + 1; }
        undo.updated.push({ id: matchId, changes: diff, ...(newOwner !== undefined ? { ownerOld: cur.ownerId, ownerNew: newOwner } : {}) });
        res.updated++;
        return;
      }

      if (spec.mode === "update_only") { fail(rowNo, "No existing record matches"); return; }
      // create (cases go through assignment rules + SLA like any new case)
      const pre = spec.object === "case" ? caseBeforeCreate(input, ownerId, actor.id) : null;
      const values = pre?.values ?? input;
      const made = createRecord(spec.object, values, actor.id, pre ? pre.ownerId : ownerId, undefined);
      if (made.errors.length || !made.id) return fail(rowNo, made.errors.join("; "));
      if (pre) caseAfterCreate(made.id, pre.notes);
      if (nameOverride && obj.nameTemplate === "{name}") db.prepare("UPDATE srecords SET name = ? WHERE id = ?").run(nameOverride, made.id);
      undo.created.push(made.id);
      res.created++;
      if (spec.matchField) {
        const k = spec.matchField === "@name" ? nameOverride : input[spec.matchField];
        if (k != null) existing!.set(canonKey(k), made.id);
      }
    });

    if (spec.dryRun) throw new Abort();
    res.batchId = batchId;
    saveBatch({ id: batchId, kind: "import", object: spec.object, label: spec.label ?? null, createdBy: actor.id, createdByName: actor.name,
      summary: { rows: res.rows, created: res.created, updated: res.updated, unchanged: res.unchanged, failed: res.failed, policy: spec.updatePolicy, mode: spec.mode } }, undo);
  });

  try { work(); } catch (e) { if (!(e instanceof Abort)) throw e; }
  return res;
}

/* ───────────────────────── rollback ───────────────────────── */

export type RollbackResult = { deleted: number; restored: number; skippedConflict: number; blocked: number };

/** Undo a batch: delete what it created, restore what it changed — unless someone has changed that field since. */
export function rollbackBatch(id: string, actor: { id: string }): RollbackResult | { error: string } {
  const b = getBatch(id);
  if (!b) return { error: "Batch not found" };
  if (b.status === "rolled_back") return { error: "This batch was already rolled back" };
  const out: RollbackResult = { deleted: 0, restored: 0, skippedConflict: 0, blocked: 0 };
  db.transaction(() => {
    for (const u of b.undo.updated ?? []) {
      const row = db.prepare("SELECT data, ownerId FROM srecords WHERE id = ?").get(u.id) as { data: string; ownerId: string | null } | undefined;
      if (!row) continue;
      const fields = getFields(b.object);
      const cur = JSON.parse(row.data) as Record<string, unknown>;
      const next = { ...cur };
      let touched = false;
      for (const [api, ch] of Object.entries(u.changes)) {
        if (JSON.stringify(cur[api] ?? null) !== JSON.stringify(ch.new ?? null)) { out.skippedConflict++; continue; }
        if (ch.old == null) delete next[api]; else next[api] = ch.old;
        touched = true;
      }
      let ownerBack: string | null | undefined;
      if (u.ownerNew !== undefined && row.ownerId === u.ownerNew) ownerBack = u.ownerOld ?? null;
      if (!touched && ownerBack === undefined) continue;
      const obj = getObject(b.object)!;
      db.prepare("UPDATE srecords SET data = ?, name = ?, ownerId = ?, updatedAt = ? WHERE id = ?")
        .run(JSON.stringify(next), computeName(obj, fields, next), ownerBack === undefined ? row.ownerId : ownerBack, new Date().toISOString(), u.id);
      if (b.object === "case" && ownerBack !== undefined) cascadeCaseOwner(u.id, ownerBack);
      logFieldChanges(b.object, u.id, fields, cur, next, { actorId: actor.id, source: "rollback", batchId: id });
      out.restored++;
    }
    for (const rid of [...(b.undo.created ?? [])].reverse()) {
      const rec = db.prepare("SELECT object FROM srecords WHERE id = ?").get(rid) as { object: string } | undefined;
      if (!rec) continue;
      const r = deleteRecord(rec.object, rid);
      if (r.error) out.blocked++; else { db.prepare("DELETE FROM record_shares WHERE recordId = ?").run(rid); out.deleted++; }
    }
    markRolledBack(id);
  })();
  return out;
}

/** Suggest a target field for each file column by comparing normalised headings with field labels / api names. */
export function suggestMapping(object: string, headers: string[]): Record<string, string> {
  const fields = getFields(object).filter((f) => f.type !== "autonumber");
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const k = canonKey(h);
    if (!k) continue;
    const hit = fields.find((f) => !used.has(f.api) && (canonKey(f.api) === k || canonKey(f.label) === k))
      ?? fields.find((f) => !used.has(f.api) && (canonKey(f.label).includes(k) || (k.length > 4 && k.includes(canonKey(f.api)))));
    if (hit) { out[h] = hit.api; used.add(hit.api); }
  }
  return out;
}
