import db from "./db";
import { getFields, getObject, newId, type SField, type SObject } from "./meta";

const API_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const isApi = (s: unknown): s is string => typeof s === "string" && API_RE.test(s);

export type RecordRow = {
  id: string; object: string; name: string; ownerId: string | null; ownerName: string | null;
  createdAt: string; updatedAt: string; values: Record<string, unknown>; refs: Record<string, string>;
};
export type Filter = { field: string; op: string; value?: string };

/* ───────────── value coercion / validation ───────────── */

function coerce(f: SField, raw: unknown): { v: unknown; err?: string } {
  if (raw === undefined || raw === null || raw === "") return { v: null };
  switch (f.type) {
    case "number": case "currency": case "percent": {
      const n = Number(raw);
      return Number.isFinite(n) ? { v: n } : { v: null, err: `${f.label} must be a number` };
    }
    case "checkbox": return { v: raw === true || raw === "true" || raw === 1 || raw === "1" };
    case "date": return /^\d{4}-\d{2}-\d{2}/.test(String(raw)) ? { v: String(raw).slice(0, 10) } : { v: null, err: `${f.label} must be a date` };
    case "datetime": return Number.isNaN(Date.parse(String(raw))) ? { v: null, err: `${f.label} must be a date/time` } : { v: String(raw).slice(0, 16) };
    case "picklist": return f.options.includes(String(raw)) ? { v: String(raw) } : { v: null, err: `${f.label}: "${raw}" is not a valid option` };
    case "multipicklist": {
      const arr = Array.isArray(raw) ? raw.map(String) : String(raw).split(";").filter(Boolean);
      const bad = arr.find((x) => !f.options.includes(x));
      return bad ? { v: null, err: `${f.label}: "${bad}" is not a valid option` } : { v: arr };
    }
    case "email": return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(raw)) ? { v: String(raw).trim() } : { v: null, err: `${f.label} must be an email` };
    case "url": return /^https?:\/\//i.test(String(raw)) ? { v: String(raw).trim() } : { v: null, err: `${f.label} must start with http(s)://` };
    case "lookup": {
      const hit = db.prepare("SELECT 1 FROM srecords WHERE id = ? AND object = ?").get(String(raw), f.ref);
      return hit ? { v: String(raw) } : { v: null, err: `${f.label}: referenced record not found` };
    }
    default: return { v: String(raw).slice(0, 20000) };
  }
}

function nextAuto(object: string, f: SField): string {
  const r = db.prepare(`INSERT INTO counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n`).get(`${object}.${f.api}`) as { n: number };
  const a = f.auto ?? { prefix: "", digits: 4 };
  return a.prefix + String(r.n).padStart(a.digits, "0");
}

/** Validate input against field metadata. `existing` makes it a partial update. */
export function buildValues(fields: SField[], input: Record<string, unknown>, existing?: Record<string, unknown>) {
  const values: Record<string, unknown> = { ...(existing ?? {}) };
  const errors: string[] = [];
  for (const f of fields) {
    if (f.type === "autonumber") continue; // system-generated
    const has = Object.prototype.hasOwnProperty.call(input, f.api);
    if (!has && existing) continue;
    let raw = has ? input[f.api] : undefined;
    if ((raw === undefined || raw === "") && !existing && f.def != null) raw = f.def;
    const { v, err } = coerce(f, raw);
    if (err) errors.push(err);
    if (v === null && f.type !== "checkbox") delete values[f.api]; else values[f.api] = v;
    if (f.required && (values[f.api] === undefined || values[f.api] === null)) errors.push(`${f.label} is required`);
  }
  return { values, errors };
}

/** "{first} {last}" / "{body:60}" → record name. Lookup tokens resolve to the target's name. */
export function computeName(obj: SObject, fields: SField[], values: Record<string, unknown>): string {
  const byApi = new Map(fields.map((f) => [f.api, f]));
  const out = obj.nameTemplate.replace(/\{(\w+)(?::(\d+))?\}/g, (_m, api: string, n?: string) => {
    const f = byApi.get(api);
    let v = values[api];
    if (v == null) return "";
    if (f?.type === "lookup") v = (db.prepare("SELECT name FROM srecords WHERE id = ?").get(String(v)) as { name: string } | undefined)?.name ?? "";
    const s = Array.isArray(v) ? v.join(", ") : String(v);
    return n ? (s.length > Number(n) ? s.slice(0, Number(n)) + "…" : s) : s;
  }).replace(/\s+/g, " ").replace(/^[\s\-/·]+|[\s\-/·]+$/g, "").trim();
  return out || obj.label;
}

/* ───────────── row shaping ───────────── */

export function shapeRows(rows: any[], fields: SField[]): RecordRow[] {
  const lookups = fields.filter((f) => f.type === "lookup");
  const ids = new Set<string>();
  const parsed = rows.map((r) => ({ ...r, values: JSON.parse(r.data || "{}") as Record<string, unknown> }));
  for (const r of parsed) for (const f of lookups) if (r.values[f.api]) ids.add(String(r.values[f.api]));
  const names = new Map<string, string>();
  if (ids.size) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      for (const x of db.prepare(`SELECT id,name FROM srecords WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as { id: string; name: string }[]) names.set(x.id, x.name);
    }
  }
  const staff = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  return parsed.map((r) => ({
    id: r.id, object: r.object, name: r.name, ownerId: r.ownerId, ownerName: r.ownerId ? staff.get(r.ownerId) ?? null : null,
    createdAt: r.createdAt, updatedAt: r.updatedAt, values: r.values,
    refs: Object.fromEntries(lookups.filter((f) => r.values[f.api]).map((f) => [f.api, names.get(String(r.values[f.api])) ?? "(deleted)"])),
  }));
}

/* ───────────── querying ───────────── */

const SYS_COL: Record<string, string> = { name: "name", ownerId: "ownerId", createdAt: "createdAt", updatedAt: "updatedAt" };

/** SQL expression for a field (metadata-validated, so it is injection-safe). */
function expr(fields: SField[], field: string): { sql: string; params: unknown[]; f?: SField } | null {
  if (SYS_COL[field]) return { sql: SYS_COL[field], params: [] };
  if (!isApi(field)) return null;
  const f = fields.find((x) => x.api === field);
  return f ? { sql: "json_extract(data, ?)", params: [`$.${field}`], f } : null;
}

export function buildWhere(object: string, fields: SField[], filters: Filter[], q?: string, ownerId?: string) {
  let sql = "object = ?";
  const params: unknown[] = [object];
  for (const flt of filters) {
    const e = expr(fields, flt.field);
    if (!e) continue;
    const v = flt.value ?? "";
    const isNum = e.f && ["number", "currency", "percent"].includes(e.f.type);
    const val = e.f?.type === "checkbox" ? (v === "true" || v === "1" ? 1 : 0) : isNum ? Number(v) : v;
    switch (flt.op) {
      case "eq": sql += ` AND ${e.sql} = ?`; params.push(...e.params, val); break;
      case "ne": sql += ` AND (${e.sql} IS NULL OR ${e.sql} != ?)`; params.push(...e.params, ...e.params, val); break;
      case "contains": sql += ` AND ${e.sql} LIKE ?`; params.push(...e.params, `%${v}%`); break;
      case "gt": sql += ` AND ${e.sql} > ?`; params.push(...e.params, val); break;
      case "gte": sql += ` AND ${e.sql} >= ?`; params.push(...e.params, val); break;
      case "lt": sql += ` AND ${e.sql} < ?`; params.push(...e.params, val); break;
      case "lte": sql += ` AND ${e.sql} <= ?`; params.push(...e.params, val); break;
      case "empty": sql += ` AND (${e.sql} IS NULL OR ${e.sql} = '')`; params.push(...e.params, ...e.params); break;
      case "notempty": sql += ` AND (${e.sql} IS NOT NULL AND ${e.sql} != '')`; params.push(...e.params, ...e.params); break;
      case "lastDays": sql += ` AND substr(${e.sql},1,10) BETWEEN date('now', ?) AND date('now')`; params.push(...e.params, `-${Math.abs(Number(v)) || 0} day`); break;
      case "nextDays": sql += ` AND substr(${e.sql},1,10) BETWEEN date('now') AND date('now', ?)`; params.push(...e.params, `+${Math.abs(Number(v)) || 0} day`); break;
      case "overdue": sql += ` AND substr(${e.sql},1,10) < date('now')`; params.push(...e.params); break;
    }
  }
  if (q) { sql += " AND (name LIKE ? OR EXISTS (SELECT 1 FROM json_each(srecords.data) WHERE json_each.value LIKE ?))"; params.push(`%${q}%`, `%${q}%`); }
  if (ownerId) { sql += " AND ownerId = ?"; params.push(ownerId); }
  return { sql, params };
}

export function listRecords(object: string, opts: { filters?: Filter[]; q?: string; ownerId?: string; sort?: string; dir?: string; limit?: number; offset?: number }) {
  const fields = getFields(object);
  const w = buildWhere(object, fields, opts.filters ?? [], opts.q, opts.ownerId);
  const e = expr(fields, opts.sort ?? "updatedAt") ?? expr(fields, "updatedAt")!;
  const dir = opts.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(500, Math.max(1, opts.limit ?? 25));
  const total = (db.prepare(`SELECT COUNT(*) n FROM srecords WHERE ${w.sql}`).get(...w.params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM srecords WHERE ${w.sql} ORDER BY ${e.sql} ${dir} LIMIT ? OFFSET ?`)
    .all(...w.params, ...e.params, limit, Math.max(0, opts.offset ?? 0));
  return { rows: shapeRows(rows, fields), total };
}

export function getRecord(object: string, id: string): RecordRow | null {
  const r = db.prepare("SELECT * FROM srecords WHERE id = ? AND object = ?").get(id, object);
  return r ? shapeRows([r], getFields(object))[0] : null;
}

/* ───────────── writes ───────────── */

export function createRecord(object: string, input: Record<string, unknown>, actorId: string | null, ownerId?: string | null) {
  const obj = getObject(object); if (!obj) return { errors: ["Unknown object"] };
  const fields = getFields(object);
  const { values, errors } = buildValues(fields, input);
  if (errors.length) return { errors };
  const id = newId("rec");
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const f of fields) if (f.type === "autonumber") values[f.api] = nextAuto(object, f);
    applyHooks(object, values, undefined);
    db.prepare("INSERT INTO srecords (id,object,name,data,ownerId,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, object, computeName(obj, fields, values), JSON.stringify(values), ownerId ?? actorId, actorId, now, now);
  })();
  return { id, errors: [] as string[] };
}

export function updateRecord(object: string, id: string, input: Record<string, unknown>, ownerId?: string | null) {
  const obj = getObject(object); if (!obj) return { errors: ["Unknown object"] };
  const cur = db.prepare("SELECT * FROM srecords WHERE id = ? AND object = ?").get(id, object) as any;
  if (!cur) return { errors: ["Record not found"], notFound: true };
  const fields = getFields(object);
  const before = JSON.parse(cur.data) as Record<string, unknown>;
  const { values, errors } = buildValues(fields, input, before);
  if (errors.length) return { errors };
  applyHooks(object, values, before);
  const changed = fields.filter((f) => JSON.stringify(values[f.api]) !== JSON.stringify(before[f.api])).map((f) => f.api);
  db.prepare("UPDATE srecords SET name = ?, data = ?, ownerId = ?, updatedAt = ? WHERE id = ?")
    .run(computeName(obj, fields, values), JSON.stringify(values), ownerId === undefined ? cur.ownerId : ownerId, new Date().toISOString(), id);
  // keep denormalised names of records that reference this one in their template fresh
  refreshDependents(id);
  return { errors: [] as string[], changed };
}

export function deleteRecord(object: string, id: string) {
  // block if referenced by a required lookup elsewhere
  const refs = db.prepare("SELECT object, api, required FROM sfields WHERE type = 'lookup' AND ref = ?").all(object) as { object: string; api: string; required: number }[];
  for (const r of refs) {
    if (!r.required) continue;
    const hit = db.prepare("SELECT 1 FROM srecords WHERE object = ? AND json_extract(data, ?) = ? LIMIT 1").get(r.object, `$.${r.api}`, id);
    if (hit) return { error: `Referenced by a required field on ${r.object}` };
  }
  // clear optional references so nothing dangles
  for (const r of refs) {
    if (r.required) continue;
    const rows = db.prepare("SELECT id,data FROM srecords WHERE object = ? AND json_extract(data, ?) = ?").all(r.object, `$.${r.api}`, id) as { id: string; data: string }[];
    for (const row of rows) { const d = JSON.parse(row.data); delete d[r.api]; db.prepare("UPDATE srecords SET data = ? WHERE id = ?").run(JSON.stringify(d), row.id); }
  }
  db.prepare("DELETE FROM srecords WHERE id = ? AND object = ?").run(id, object);
  return { error: null };
}

function refreshDependents(id: string) {
  const deps = db.prepare("SELECT object, api FROM sfields WHERE type = 'lookup' AND ref = (SELECT object FROM srecords WHERE id = ?)").all(id) as { object: string; api: string }[];
  for (const d of deps) {
    const obj = getObject(d.object);
    if (!obj || !obj.nameTemplate.includes(`{${d.api}`)) continue;
    const fields = getFields(d.object);
    for (const r of db.prepare("SELECT id,data FROM srecords WHERE object = ? AND json_extract(data, ?) = ?").all(d.object, `$.${d.api}`, id) as { id: string; data: string }[])
      db.prepare("UPDATE srecords SET name = ? WHERE id = ?").run(computeName(obj, fields, JSON.parse(r.data)), r.id);
  }
}

/** Small built-in automations. Case: stamp / clear Closed Date when status changes. */
function applyHooks(object: string, values: Record<string, unknown>, before?: Record<string, unknown>) {
  if (object === "case" && values.status !== before?.status) {
    if (values.status === "Closed") values.closedDate = values.closedDate ?? new Date().toISOString().slice(0, 10);
    else delete values.closedDate;
  }
}

/* ───────────── aggregation (reports + dashboards) ───────────── */

export type AggSpec = {
  object: string; filters?: Filter[]; groupBy?: string;
  metric?: "count" | "sum" | "avg" | "min" | "max"; metricField?: string; limit?: number; sort?: "value" | "key";
};

export function aggregate(spec: AggSpec) {
  const obj = getObject(spec.object); if (!obj) throw new Error("Unknown object");
  const fields = getFields(spec.object);
  const w = buildWhere(spec.object, fields, spec.filters ?? []);
  const metric = spec.metric ?? "count";
  let valSql = "COUNT(*)"; const valParams: unknown[] = [];
  if (metric !== "count") {
    const m = spec.metricField && expr(fields, spec.metricField);
    if (!m || !m.f || !["number", "currency", "percent"].includes(m.f.type)) throw new Error("Choose a numeric field to " + metric);
    valSql = `${metric.toUpperCase()}(CAST(${m.sql} AS REAL))`; valParams.push(...m.params);
  }
  const total = (db.prepare(`SELECT ${valSql} v, COUNT(*) c FROM srecords WHERE ${w.sql}`).get(...valParams, ...w.params) as { v: number | null; c: number });
  if (!spec.groupBy) return { total: total.v ?? 0, count: total.c, groups: [] as Array<{ key: string; label: string; value: number; count: number }> };

  const [gField, gMode] = spec.groupBy.split(":");
  const g = expr(fields, gField);
  if (!g) throw new Error("Unknown group-by field");
  if (g.f?.type === "multipicklist") throw new Error("Cannot group by a multi-select field");
  const keySql = gMode === "month" ? `substr(${g.sql},1,7)` : gMode === "day" ? `substr(${g.sql},1,10)` : g.sql;
  const limit = Math.min(100, spec.limit ?? 25);
  const order = spec.sort === "key" || gMode ? "k ASC" : "v DESC";
  const rows = db.prepare(`SELECT ${keySql} k, ${valSql} v, COUNT(*) c FROM srecords WHERE ${w.sql} GROUP BY k ORDER BY ${order} LIMIT ?`)
    .all(...g.params, ...valParams, ...w.params, limit) as { k: string | number | null; v: number | null; c: number }[];

  let labelOf = (k: string) => k;
  if (g.f?.type === "lookup") {
    const ids = rows.map((r) => r.k).filter(Boolean) as string[];
    const nm = new Map<string, string>();
    if (ids.length) for (const x of db.prepare(`SELECT id,name FROM srecords WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; name: string }[]) nm.set(x.id, x.name);
    labelOf = (k) => nm.get(k) ?? "(deleted)";
  } else if (gField === "ownerId") {
    const nm = new Map((db.prepare("SELECT id,name FROM staff").all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    labelOf = (k) => nm.get(k) ?? "Unassigned";
  } else if (g.f?.type === "checkbox") labelOf = (k) => (String(k) === "1" ? "Yes" : "No");
  return {
    total: total.v ?? 0, count: total.c,
    groups: rows.map((r) => ({ key: String(r.k ?? ""), label: r.k == null || r.k === "" ? "(none)" : labelOf(String(r.k)), value: Math.round((r.v ?? 0) * 100) / 100, count: r.c })),
  };
}
