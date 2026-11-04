import db from "./db";
import { logAudit } from "./audit";
import { createRecord, updateRecord } from "./records";

/**
 * Case automation (Salesforce "assignment rules" + "entitlements/escalation rules").
 *  1. On create : first matching assignment rule picks the owner; the SLA policy for the
 *                 case priority fills in the due date when none was entered.
 *  2. On a timer: warns before the due date and escalates cases that are overdue.
 * Rules are data (table automation_config), edited at /setup/automation.
 */

export type Cond = { field: string; op: "eq" | "ne" | "contains" | "empty" | "notempty"; value?: string };
export type AssignRule = { id: string; name: string; enabled: boolean; conditions: Cond[]; mode: "staff" | "pool" | "auto"; staffId?: string; staffIds?: string[] };
export type AssignConfig = { enabled: boolean; rules: AssignRule[]; fallback: "auto" | "creator" };
export type Policy = { priority: string; dueInDays: number; warnDaysBefore: number; escalateAfterDays: number };
export type SlaConfig = { enabled: boolean; policies: Policy[]; pauseStatuses: string[]; escalateTo: string };

db.exec(`
CREATE TABLE IF NOT EXISTS automation_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, object TEXT NOT NULL, recordId TEXT NOT NULL,
  mark TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_autolog_rec ON automation_log(recordId, mark);
`);

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const DEFAULT_ASSIGN: AssignConfig = { enabled: true, rules: [], fallback: "auto" };
const DEFAULT_SLA: SlaConfig = {
  enabled: true, pauseStatuses: ["Waiting on Member", "Waiting on Provider"], escalateTo: "",
  policies: [
    { priority: "Urgent", dueInDays: 1, warnDaysBefore: 1, escalateAfterDays: 0 },
    { priority: "High", dueInDays: 2, warnDaysBefore: 1, escalateAfterDays: 1 },
    { priority: "Medium", dueInDays: 5, warnDaysBefore: 1, escalateAfterDays: 2 },
    { priority: "Low", dueInDays: 10, warnDaysBefore: 2, escalateAfterDays: 5 },
  ],
};

function read<T>(key: string, dflt: T): T {
  const r = db.prepare("SELECT value FROM automation_config WHERE key = ?").get(key) as { value: string } | undefined;
  return r ? { ...dflt, ...JSON.parse(r.value) } : dflt;
}
export const getAssignConfig = () => read<AssignConfig>("case.assignment", DEFAULT_ASSIGN);
export const getSlaConfig = () => read<SlaConfig>("case.sla", DEFAULT_SLA);
const write = (key: string, v: unknown) =>
  db.prepare("INSERT INTO automation_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(v));

/** Validate + save. Returns an error message or null. */
export function saveConfig(assign: AssignConfig, sla: SlaConfig): string | null {
  const staff = new Set((db.prepare("SELECT id FROM staff").all() as { id: string }[]).map((s) => s.id));
  for (const r of assign.rules ?? []) {
    if (!r.name?.trim()) return "Every assignment rule needs a name";
    if (r.mode === "staff" && !staff.has(r.staffId ?? "")) return `Rule "${r.name}": choose a team member`;
    if (r.mode === "pool" && !(r.staffIds ?? []).length) return `Rule "${r.name}": choose at least one team member for the pool`;
    if (r.mode === "pool" && r.staffIds!.some((s) => !staff.has(s))) return `Rule "${r.name}": unknown team member`;
  }
  for (const p of sla.policies ?? []) {
    if (!PRIORITIES.includes(p.priority)) return `Unknown priority ${p.priority}`;
    if (![p.dueInDays, p.warnDaysBefore, p.escalateAfterDays].every((n) => Number.isFinite(n) && n >= 0 && n <= 365)) return `${p.priority}: days must be 0–365`;
  }
  if (sla.escalateTo && !staff.has(sla.escalateTo)) return "Unknown escalation owner";
  write("case.assignment", { enabled: !!assign.enabled, fallback: assign.fallback === "creator" ? "creator" : "auto", rules: assign.rules ?? [] });
  write("case.sla", { enabled: !!sla.enabled, policies: sla.policies ?? [], pauseStatuses: sla.pauseStatuses ?? [], escalateTo: sla.escalateTo ?? "" });
  return null;
}

/* ───────────── assignment ───────────── */

function matches(values: Record<string, unknown>, conds: Cond[]) {
  return conds.every((c) => {
    const v = values[c.field];
    const s = Array.isArray(v) ? v.join(";") : v == null ? "" : String(v);
    switch (c.op) {
      case "eq": return s === (c.value ?? "");
      case "ne": return s !== (c.value ?? "");
      case "contains": return s.toLowerCase().includes((c.value ?? "").toLowerCase());
      case "empty": return s === "";
      case "notempty": return s !== "";
    }
  });
}

const openLoad = (id: string) =>
  (db.prepare("SELECT COUNT(*) n FROM srecords WHERE object = 'case' AND ownerId = ? AND COALESCE(json_extract(data,'$.status'),'') != 'Closed'").get(id) as { n: number }).n;

function leastLoaded(candidates: string[] | null): string | null {
  const rows = db.prepare("SELECT id FROM staff WHERE isActive = 1 AND isAvailable = 1 ORDER BY id").all() as { id: string }[];
  const pool = rows.map((r) => r.id).filter((id) => !candidates || candidates.includes(id));
  if (!pool.length) return null;
  return pool.map((id) => ({ id, n: openLoad(id) })).sort((a, b) => a.n - b.n || a.id.localeCompare(b.id))[0].id;
}

type Note = { action: string; detail: string };

/** Pre-insert: choose the owner and default the due date. An explicit owner/due date always wins. */
export function caseBeforeCreate(values: Record<string, unknown>, explicitOwner: string | null | undefined, creatorId: string | null) {
  const notes: Note[] = [];
  const v = { ...values };
  let ownerId: string | null = explicitOwner ?? null;

  const sla = getSlaConfig();
  if (sla.enabled && !v.dueDate) {
    const pol = sla.policies.find((p) => p.priority === (v.priority || "Medium"));
    if (pol) {
      v.dueDate = new Date(Date.now() + pol.dueInDays * 86400000).toISOString().slice(0, 10);
      notes.push({ action: "automation.case.sla_due", detail: `${v.priority || "Medium"}: due in ${pol.dueInDays}d` });
    }
  }

  if (!ownerId) {
    const cfg = getAssignConfig();
    if (cfg.enabled) {
      for (const r of cfg.rules.filter((x) => x.enabled)) {
        if (!matches(v, r.conditions ?? [])) continue;
        const pick = r.mode === "staff" ? (leastLoaded([r.staffId!]) ?? null) : r.mode === "pool" ? leastLoaded(r.staffIds ?? []) : leastLoaded(null);
        if (pick) { ownerId = pick; notes.push({ action: "automation.case.assign", detail: `rule "${r.name}"` }); break; }
      }
      if (!ownerId && cfg.fallback === "auto") {
        ownerId = leastLoaded(null);
        if (ownerId) notes.push({ action: "automation.case.assign", detail: "fallback: least-loaded available staff" });
      }
    }
    if (!ownerId) ownerId = creatorId;
  }
  return { values: v, ownerId, notes };
}

export function caseAfterCreate(id: string, notes: Note[]) {
  for (const n of notes) logAudit({ actorId: null, actorName: "Automation", action: n.action, resource: "case", resourceId: id, detail: n.detail });
}

/** A user changed due date / priority / status → let the sweep evaluate the case afresh. */
export function resetSlaMarks(id: string) {
  db.prepare("DELETE FROM automation_log WHERE recordId = ? AND mark IN ('warn','escalate')").run(id);
}

/* ───────────── SLA sweep ───────────── */

const marked = (id: string, mark: string) => !!db.prepare("SELECT 1 FROM automation_log WHERE recordId = ? AND mark = ?").get(id, mark);
function mark(id: string, m: string, action: string, detail: string) {
  db.prepare("INSERT INTO automation_log (ts,object,recordId,mark,action,detail) VALUES (?,?,?,?,?,?)").run(new Date().toISOString(), "case", id, m, action, detail);
  logAudit({ actorId: null, actorName: "Automation", action: `automation.case.${action}`, resource: "case", resourceId: id, detail });
}
function alertPost(id: string, body: string) {
  createRecord("chatter", { body, postType: "Alert", relatedObject: "case", relatedRecordId: id }, null, null);
}

export function runCaseSweep(): { warned: number; escalated: number; checked: number } {
  const sla = getSlaConfig();
  const out = { warned: 0, escalated: 0, checked: 0 };
  if (!sla.enabled) return out;
  const today = new Date().toISOString().slice(0, 10);
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  const rows = db.prepare(
    `SELECT id, name, ownerId, data FROM srecords WHERE object = 'case'
     AND COALESCE(json_extract(data,'$.status'),'') != 'Closed' AND json_extract(data,'$.dueDate') IS NOT NULL`
  ).all() as { id: string; name: string; ownerId: string | null; data: string }[];

  for (const r of rows) {
    const d = JSON.parse(r.data) as Record<string, string>;
    out.checked++;
    if (sla.pauseStatuses.includes(d.status)) continue; // clock paused while waiting on someone else
    const pol = sla.policies.find((p) => p.priority === (d.priority || "Medium"));
    if (!pol) continue;
    const untilDue = dayDiff(d.dueDate, today); // >0 future, 0 today, <0 overdue

    if (untilDue >= 0 && untilDue <= pol.warnDaysBefore && !marked(r.id, "warn")) {
      mark(r.id, "warn", "sla_warn", `due ${untilDue === 0 ? "today" : `in ${untilDue}d`}`);
      alertPost(r.id, `⏰ SLA warning: this case is due ${untilDue === 0 ? "today" : `in ${untilDue} day${untilDue === 1 ? "" : "s"}`}.`);
      out.warned++;
    }
    if (untilDue < 0 && -untilDue >= pol.escalateAfterDays && d.status !== "Escalated" && !marked(r.id, "escalate")) {
      const next = PRIORITIES[Math.min(PRIORITIES.length - 1, PRIORITIES.indexOf(d.priority || "Medium") + 1)];
      const res = updateRecord("case", r.id, { status: "Escalated", priority: next }, sla.escalateTo || undefined);
      if (res.errors.length) continue;
      mark(r.id, "escalate", "sla_escalate", `${-untilDue}d overdue → Escalated, priority ${d.priority || "Medium"} → ${next}${sla.escalateTo ? ", reassigned" : ""}`);
      alertPost(r.id, `🚨 Escalated automatically: ${-untilDue} day${-untilDue === 1 ? "" : "s"} past due. Priority raised to ${next}.`);
      out.escalated++;
    }
  }
  return out;
}

export function recentLog(limit = 50) {
  return db.prepare(
    `SELECT l.id, l.ts, l.recordId, l.action, l.detail, s.name AS recordName
     FROM automation_log l LEFT JOIN srecords s ON s.id = l.recordId ORDER BY l.id DESC LIMIT ?`
  ).all(limit);
}

/* ───────────── scheduler (in-process; no external cron needed) ───────────── */

const g = globalThis as any;
if (!g.__caseSweepTimer && process.env.NEXT_PHASE !== "phase-production-build") {
  const tick = () => { try { runCaseSweep(); } catch (e) { console.error("case sweep failed", e); } };
  g.__caseSweepTimer = setInterval(tick, 10 * 60 * 1000);
  g.__caseSweepTimer.unref?.();
  setTimeout(tick, 20_000).unref?.();
}
