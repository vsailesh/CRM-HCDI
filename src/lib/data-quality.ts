import db from "./db";
import { getFields, getObject, type SField } from "./meta";
import { blockedForAggregate, visibleSql, type Viewer } from "./access";
import { ageOn, canonKey, digitsOf, normDate, normPhoneUS, normState, normZip } from "./normalize";

/**
 * Data-quality scorecard for one object: completeness per field, format problems, duplicate keys.
 * Returns COUNTS and record ids only — never field values. Fields the viewer cannot see are skipped.
 */
export type FieldQuality = { api: string; label: string; type: string; filled: number; pct: number; invalid: number; fixable: number };
export type DupGroup = { key: string; field: string; count: number; ids: string[] };
export type Quality = {
  object: string; total: number; score: number; fields: FieldQuality[];
  duplicates: { field: string; label: string; groups: number; records: number; sample: DupGroup[] }[];
  issues: { label: string; count: number; fixField?: string }[];
};

const KEY_HINT = /(^|\b)(memberid|medicaidid|externalid|npi|ssn|email|phone|statecasenumber)$/i;

/** Checks a value against what its field type expects. `fixable` = the normaliser can repair it. */
function check(f: SField, v: unknown): { bad: boolean; fixable: boolean } {
  if (v == null || v === "") return { bad: false, fixable: false };
  const s = String(v);
  if (f.type === "phone") { const ok = /^\(\d{3}\) \d{3}-\d{4}$/.test(s); return { bad: !ok, fixable: !ok && !!normPhoneUS(s) }; }
  if (f.type === "date") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) && !!normDate(s);
    if (/dob|birth/i.test(f.api) && iso) { const age = ageOn(s); return { bad: age == null || age < 0 || age > 120, fixable: false }; }
    return { bad: !iso, fixable: !iso && !!normDate(s) };
  }
  if (f.type === "email") return { bad: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), fixable: false };
  if (/zip|postal/i.test(f.api)) { const ok = /^\d{5}(-\d{4})?$/.test(s); return { bad: !ok, fixable: !ok && !!normZip(s) }; }
  if (f.api === "state") { const ok = !!normState(s) && s === s.toUpperCase(); return { bad: !ok, fixable: !ok && !!normState(s) }; }
  return { bad: false, fixable: false };
}

export function scoreObject(object: string, viewer?: Viewer): Quality {
  const obj = getObject(object); if (!obj) throw new Error("Unknown object");
  const fields = getFields(object).filter((f) => !["autonumber", "textarea"].includes(f.type));
  const blk = blockedForAggregate(fields, viewer);
  const vis = visibleSql(object, viewer);
  const rows = db.prepare(`SELECT id,name,data FROM srecords WHERE object = ?${vis.sql}`).all(object, ...vis.params) as { id: string; name: string; data: string }[];
  const usable = fields.filter((f) => !blk.admin.has(f.api) && !blk.owner.has(f.api));
  const stats = new Map(usable.map((f) => [f.api, { filled: 0, invalid: 0, fixable: 0 }]));
  const keys = usable.filter((f) => ["text", "email", "phone"].includes(f.type) && KEY_HINT.test(f.api));
  const keyMaps = new Map(keys.map((f) => [f.api, new Map<string, string[]>()]));
  const nameMap = new Map<string, string[]>();
  let requiredMissing = 0;

  for (const r of rows) {
    const d = JSON.parse(r.data) as Record<string, unknown>;
    for (const f of usable) {
      const v = d[f.api], st = stats.get(f.api)!;
      const has = v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
      if (has) st.filled++;
      else if (f.required) requiredMissing++;
      const c = check(f, v);
      if (c.bad) st.invalid++;
      if (c.fixable) st.fixable++;
    }
    for (const f of keys) {
      const k = f.type === "phone" ? digitsOf(d[f.api]).slice(-10) : canonKey(d[f.api]);
      if (k.length >= 4) { const m = keyMaps.get(f.api)!; (m.get(k) ?? m.set(k, []).get(k)!).push(r.id); }
    }
    if (obj.nameTemplate.includes("{") && /^(contact|provider|account|household)$/.test(object)) {
      const dob = typeof d.dob === "string" ? d.dob : "";
      const k = canonKey(r.name) + (dob ? `|${dob}` : "");
      if (canonKey(r.name)) (nameMap.get(k) ?? nameMap.set(k, []).get(k)!).push(r.id);
    }
  }

  const fieldQ: FieldQuality[] = usable.map((f) => {
    const s = stats.get(f.api)!;
    return { api: f.api, label: f.label, type: f.type, filled: s.filled, pct: rows.length ? Math.round((s.filled / rows.length) * 100) : 100, invalid: s.invalid, fixable: s.fixable };
  });
  const dupes = [...keys.map((f) => ({ f, m: keyMaps.get(f.api)! })), { f: { api: "name", label: object === "contact" ? "Name + DOB" : "Name" } as SField, m: nameMap }]
    .map(({ f, m }) => {
      const groups = [...m.entries()].filter(([, ids]) => ids.length > 1);
      return { field: f.api, label: f.label, groups: groups.length, records: groups.reduce((n, [, ids]) => n + ids.length, 0),
        sample: groups.slice(0, 5).map(([key, ids]) => ({ key: "", field: f.api, count: ids.length, ids: ids.slice(0, 10) }) as DupGroup) };
    }).filter((d) => d.groups > 0);

  const required = usable.filter((f) => f.required);
  const completeness = fieldQ.length ? fieldQ.reduce((n, f) => n + f.pct, 0) / fieldQ.length : 100;
  const invalidTotal = fieldQ.reduce((n, f) => n + f.invalid, 0);
  const validity = rows.length && fieldQ.length ? 100 - Math.min(100, (invalidTotal / (rows.length * Math.max(1, fieldQ.filter((f) => ["phone", "date", "email"].includes(f.type) || /zip|state/.test(f.api)).length))) * 100) : 100;
  const dupPenalty = rows.length ? Math.min(30, (dupes.reduce((n, d) => n + d.records, 0) / rows.length) * 100) : 0;
  const score = rows.length ? Math.max(0, Math.round(completeness * 0.5 + validity * 0.5 - dupPenalty)) : 100;

  const issues: Quality["issues"] = [];
  for (const f of fieldQ) if (f.invalid) issues.push({ label: `${f.label}: ${f.invalid} value${f.invalid === 1 ? "" : "s"} in the wrong format${f.fixable ? ` (${f.fixable} can be fixed automatically)` : ""}`, count: f.invalid, fixField: f.fixable ? f.api : undefined });
  if (requiredMissing) issues.push({ label: `${requiredMissing} required value${requiredMissing === 1 ? " is" : "s are"} missing`, count: requiredMissing });
  for (const d of dupes) issues.push({ label: `${d.groups} possible duplicate group${d.groups === 1 ? "" : "s"} on ${d.label} (${d.records} records)`, count: d.records });
  void required;
  return { object, total: rows.length, score, fields: fieldQ, duplicates: dupes, issues };
}

/** Rewrites values the normalisers can repair (phone, ZIP, state, dates). Returns how many fields were changed. */
export function normalizeField(object: string, fieldApi: string, actorId: string | null): { records: number } {
  const f = getFields(object).find((x) => x.api === fieldApi);
  if (!f) throw new Error("Unknown field");
  const rows = db.prepare("SELECT id,data FROM srecords WHERE object = ?").all(object) as { id: string; data: string }[];
  const upd = db.prepare("UPDATE srecords SET data = ?, updatedAt = ? WHERE id = ?");
  const log = db.prepare("INSERT INTO field_history (recordId,object,field,oldValue,newValue,changedAt,changedBy,source) VALUES (?,?,?,?,?,?,?,'bulk')");
  let n = 0;
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const r of rows) {
      const d = JSON.parse(r.data) as Record<string, unknown>;
      const v = d[fieldApi]; if (v == null || v === "") continue;
      const c = check(f, v); if (!c.bad || !c.fixable) continue;
      const s = String(v);
      const fixed = f.type === "phone" ? normPhoneUS(s) : f.type === "date" ? normDate(s, { dob: /dob|birth/i.test(f.api) }) : /zip|postal/i.test(f.api) ? normZip(s) : f.api === "state" ? normState(s) : null;
      if (!fixed || fixed === s) continue;
      d[fieldApi] = fixed;
      upd.run(JSON.stringify(d), now, r.id);
      log.run(r.id, object, fieldApi, JSON.stringify(v), JSON.stringify(fixed), now, actorId);
      n++;
    }
  })();
  return { records: n };
}
