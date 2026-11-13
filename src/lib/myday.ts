import db from "./db";
import { createRecord, shapeRows, updateRecord } from "./records";
import { getFields } from "./meta";
import type { Viewer } from "./access";

/**
 * CHW workspace logic.
 *   logOutreach  — record an attempt from a case: creates the engagement-log entry and keeps the case's
 *                  attempts / last outreach / engagement status in step.
 *   myDay        — today's call list for one person: their open cases ranked by urgency, each with the reasons
 *                  it is on the list, the member's open gaps and the recert deadline.
 * Everything is scoped to the cases the person owns. Output goes only to that person.
 */
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const daysFrom = (d: string) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 86400000);

export const OUTCOMES = ["Reached - Completed", "Reached - Callback Requested", "Reached - Declined", "No Answer", "Left Voicemail", "Wrong Number", "Disconnected", "Language Barrier"];
const NEXT = ["Call Again", "Send Letter", "Schedule Appointment", "Refer to Provider", "Refer to Community Resource", "Close Case", "None"];
const CHANNELS = ["Phone", "SMS", "Email", "Voicemail", "Home Visit", "Mail", "Clinic Visit"];
export const UNREACHABLE_AFTER = 3;

type Input = { channel?: string; outcome?: string; nextStep?: string; followUpDate?: string; notes?: string; languageUsed?: string; interpreterUsed?: boolean };

export function logOutreach(caseId: string, input: Input, actorId: string): { id?: string; errors: string[]; engagementStatus?: string } {
  const c = db.prepare("SELECT id, data FROM srecords WHERE id = ? AND object = 'case'").get(caseId) as { id: string; data: string } | undefined;
  if (!c) return { errors: ["Case not found"] };
  const d = JSON.parse(c.data) as Record<string, unknown>;
  if (!d.contact) return { errors: ["This case has no member (contact) — add one before logging outreach"] };
  if (!input.outcome || !OUTCOMES.includes(input.outcome)) return { errors: ["Choose an outcome"] };
  const channel = input.channel && CHANNELS.includes(input.channel) ? input.channel : "Phone";
  if (input.nextStep && !NEXT.includes(input.nextStep)) return { errors: ["Unknown next step"] };

  const attempts = Number(d.outreachAttempts ?? 0) + 1;
  const reached = input.outcome.startsWith("Reached");
  const status = input.outcome === "Reached - Declined" ? "Declined" : reached ? "Engaged"
    : attempts >= UNREACHABLE_AFTER && d.engagementStatus !== "Engaged" ? "Unable to Reach" : "Attempting Contact";
  let result: { id?: string; errors: string[] } = { errors: [] };
  db.transaction(() => {
    result = createRecord("engagement_log", {
      contact: d.contact, case: caseId, household: d.household, channel, direction: "Outbound", interactionDate: today(), attemptNumber: attempts,
      outcome: input.outcome, nextStep: input.nextStep || undefined, followUpDate: input.followUpDate || undefined, notes: input.notes || undefined,
      languageUsed: input.languageUsed || undefined, interpreterUsed: !!input.interpreterUsed,
    }, actorId, actorId);
    if (result.errors.length) return;
    const u = updateRecord("case", caseId, { outreachAttempts: attempts, lastOutreachDate: today(), engagementStatus: status }, undefined, undefined, { actorId, source: "automation" });
    if (u.errors.length) result = { errors: u.errors };
  })();
  return { ...result, engagementStatus: status };
}

export type CallItem = {
  caseId: string; caseName: string; contactId: string | null; contactName: string | null; phone: string | null; language: string | null;
  priority: string | null; status: string | null; dueDate: string | null; recertDueDate: string | null; recertCohort: string | null;
  attempts: number; lastOutreach: string | null; engagementStatus: string | null; followUpDue: string | null;
  gaps: Array<{ id: string; measure: string }>; reasons: string[]; score: number; doneToday: boolean;
};

export function myDay(viewer: Viewer, limit = 60) {
  const t = today();
  const cases = db.prepare(`SELECT * FROM srecords WHERE object = 'case' AND ownerId = ? AND COALESCE(json_extract(data,'$.status'),'') != 'Closed'`).all(viewer.id) as Array<Record<string, unknown>>;
  const names = new Map<string, { name: string; phone?: string; lang?: string }>();
  const cids = [...new Set(cases.map((c) => (JSON.parse(String(c.data)) as { contact?: string }).contact).filter(Boolean))] as string[];
  const contactFields = getFields("contact");
  for (let i = 0; i < cids.length; i += 400) {
    const ch = cids.slice(i, i + 400);
    const rows = db.prepare(`SELECT * FROM srecords WHERE id IN (${ch.map(() => "?").join(",")})`).all(...ch);
    for (const r of shapeRows(rows, contactFields, viewer)) names.set(r.id, { name: r.name, phone: r.values.phone as string | undefined, lang: r.values.preferredLanguage as string | undefined });
  }
  // open gaps on the viewer's cases (a CHW's gaps are exactly the gaps on their cases)
  const gapRows = db.prepare(`SELECT g.id, json_extract(g.data,'$.case') cid, COALESCE(m.name,'') measure FROM srecords g
    LEFT JOIN srecords m ON m.id = json_extract(g.data,'$.measure')
    WHERE g.object = 'member_measure_status' AND g.ownerId = ? AND json_extract(g.data,'$.gapStatus') = 'Open'`).all(viewer.id) as Array<{ id: string; cid: string | null; measure: string }>;
  const gapsByCase = new Map<string, Array<{ id: string; measure: string }>>();
  for (const g of gapRows) if (g.cid) (gapsByCase.get(g.cid) ?? gapsByCase.set(g.cid, []).get(g.cid)!).push({ id: g.id, measure: g.measure.split(" - ")[0] });

  const lastFollow = db.prepare(`SELECT json_extract(data,'$.followUpDate') f FROM srecords WHERE object = 'engagement_log' AND json_extract(data,'$.case') = ?
    AND json_extract(data,'$.followUpDate') IS NOT NULL ORDER BY json_extract(data,'$.interactionDate') DESC, createdAt DESC LIMIT 1`);
  const doneToday = new Set((db.prepare(`SELECT json_extract(data,'$.case') c FROM srecords WHERE object = 'engagement_log' AND ownerId = ? AND json_extract(data,'$.interactionDate') = ?`).all(viewer.id, t) as { c: string }[]).map((r) => r.c));

  const items: CallItem[] = cases.map((r) => {
    const d = JSON.parse(String(r.data)) as Record<string, unknown>;
    const contact = d.contact ? names.get(String(d.contact)) : undefined;
    const gaps = gapsByCase.get(String(r.id)) ?? [];
    const attempts = Number(d.outreachAttempts ?? 0);
    const follow = (lastFollow.get(r.id) as { f: string | null } | undefined)?.f ?? null;
    const reasons: string[] = []; let score = 0;
    const due = d.dueDate ? daysFrom(String(d.dueDate)) : null;
    if (due != null && due < 0) { reasons.push(`Overdue ${-due}d`); score += 60 + Math.min(30, -due); }
    else if (due != null && due <= 2) { reasons.push(due === 0 ? "Due today" : `Due in ${due}d`); score += 40; }
    const rc = d.recertDueDate ? daysFrom(String(d.recertDueDate)) : null;
    if (rc != null && rc < 0) { reasons.push(`Recert ${-rc}d past due`); score += 55; }
    else if (rc != null && rc <= 14) { reasons.push(`Recert due in ${rc}d`); score += rc <= 7 ? 45 : 30; }
    if (follow && follow <= t) { reasons.push("Follow-up due"); score += 50; }
    if (attempts === 0 && (d.status === "New" || !d.lastOutreachDate)) { reasons.push("Never contacted"); score += 35; }
    if (gaps.length) { reasons.push(`${gaps.length} open gap${gaps.length === 1 ? "" : "s"}`); score += Math.min(20, gaps.length * 6); }
    if (d.priority === "Urgent") score += 25; else if (d.priority === "High") score += 12;
    if (d.engagementStatus === "Unable to Reach") score -= 20;
    return {
      caseId: String(r.id), caseName: String(r.name), contactId: d.contact ? String(d.contact) : null, contactName: contact?.name ?? null, phone: contact?.phone ?? null,
      language: (d.memberLanguage as string) ?? contact?.lang ?? null, priority: (d.priority as string) ?? null, status: (d.status as string) ?? null,
      dueDate: (d.dueDate as string) ?? null, recertDueDate: (d.recertDueDate as string) ?? null, recertCohort: (d.recertCohort as string) ?? null,
      attempts, lastOutreach: (d.lastOutreachDate as string) ?? null, engagementStatus: (d.engagementStatus as string) ?? null, followUpDue: follow,
      gaps, reasons, score, doneToday: doneToday.has(String(r.id)),
    };
  });
  const todo = items.filter((i) => i.reasons.some((x) => !/open gap/.test(x)) && !i.doneToday).sort((a, b) => b.score - a.score);
  const rest = items.filter((i) => !todo.includes(i) && !i.doneToday).sort((a, b) => b.score - a.score);
  const stats = {
    openCases: items.length, callList: todo.length, doneToday: doneToday.size, openGaps: gapRows.length,
    recertSoon: items.filter((i) => i.recertDueDate && daysFrom(i.recertDueDate) <= 14).length,
    followUpsDue: items.filter((i) => i.followUpDue && i.followUpDue <= t).length,
  };
  return { stats, callList: todo.slice(0, limit), others: rest.slice(0, 20), soonest: addDays(14) };
}
