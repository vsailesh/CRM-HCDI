import db from "./db";
import { getFields } from "./meta";
import { aggregate, buildWhere, type Filter } from "./records";
import type { Viewer } from "./access";

/**
 * KPI engine for the outreach program: care-gap closure, case flow & SLA, redetermination compliance,
 * member outreach, and SDOH. Everything goes through the same record-access rules as the list views
 * (a CHW's KPIs cover the records they may open; admins see everything). Output is counts and rates only.
 */
export type Unit = "count" | "pct" | "days";
export type Tile = { key: string; label: string; value: number | null; prev: number | null; unit: Unit; good: "up" | "down"; hint: string };
export type RateRow = { key: string; label: string; total: number; done: number; rate: number; target?: number | null };
export type CountRow = { key: string; label: string; value: number };
export type TrendPoint = { key: string; a: number; b: number };

export type Kpis = {
  period: { days: number; from: string; to: string; unit: "week" | "month" };
  tiles: Tile[];
  gaps: { total: number; closed: number; rate: number | null; byMeasure: RateRow[]; byPlan: RateRow[]; byChw: RateRow[]; bySource: CountRow[]; trend: TrendPoint[] };
  cases: { byStatus: CountRow[]; aging: CountRow[]; workload: Array<{ key: string; label: string; open: number; overdue: number }>; trend: TrendPoint[]; byType: CountRow[] };
  recert: { byCohort: RateRow[]; due: CountRow[]; overdueOpen: number };
  outreach: { outcomes: CountRow[]; byChw: RateRow[]; byChannel: CountRow[]; trend: TrendPoint[] };
  sdoh: { screenings: number; declined: number; needs: CountRow[]; referrals: CountRow[]; housing: CountRow[] };
};

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const OPEN: Filter = { field: "status", op: "ne", value: "Closed" };

export function computeKpis(opts: { days: number; account?: string; viewer?: Viewer }): Kpis {
  const days = [7, 30, 90, 180, 365].includes(opts.days) ? opts.days : 30;
  const from = day(-days), to = day(1), prevFrom = day(-2 * days);
  const unit: "week" | "month" = days > 120 ? "month" : "week";
  const { viewer, account } = opts;
  const F = (object: string) => getFields(object);
  const W = (object: string, filters: Filter[]) => buildWhere(object, F(object), filters, undefined, undefined, viewer);
  const cnt = (object: string, filters: Filter[], extra = "") => {
    const w = W(object, filters);
    return (db.prepare(`SELECT COUNT(*) n FROM srecords WHERE ${w.sql} ${extra}`).get(...w.params) as { n: number }).n;
  };
  const acct = (object: string): Filter[] => {
    if (!account) return [];
    const f = object === "case" ? "account" : object === "member_measure_status" || object === "sdoh_assessment" ? "healthPlan" : "";
    return f ? [{ field: f, op: "eq", value: account }] : [];
  };
  const range = (field: string, a: string, b: string): Filter[] => [{ field, op: "gte", value: a }, { field, op: "lt", value: b }];
  const group = (object: string, groupBy: string, filters: Filter[], limit = 20): CountRow[] =>
    aggregate({ object, groupBy, filters: [...filters, ...acct(object)], limit, viewer }).groups.map((g) => ({ key: g.key, label: g.label, value: g.value }));

  /** rate rows: share of records matching `done` among those matching `base`, per group */
  const rates = (object: string, groupBy: string, base: Filter[], done: Filter[], limit = 25): RateRow[] => {
    const all = aggregate({ object, groupBy, filters: [...base, ...acct(object)], limit: 100, viewer }).groups;
    const dn = new Map(aggregate({ object, groupBy, filters: [...base, ...done, ...acct(object)], limit: 100, viewer }).groups.map((g) => [g.key, g.value]));
    return all.map((g) => ({ key: g.key, label: g.label, total: g.value, done: dn.get(g.key) ?? 0, rate: pct(dn.get(g.key) ?? 0, g.value) ?? 0 }))
      .sort((a, b) => b.total - a.total).slice(0, limit);
  };

  /** bucketed time series for up to two measures of one object */
  const keys: string[] = [];
  if (unit === "week") {
    const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    for (; d.toISOString().slice(0, 10) <= day(0); d.setUTCDate(d.getUTCDate() + 7)) keys.push(d.toISOString().slice(0, 10));
  } else {
    const d = new Date(from.slice(0, 7) + "-01T00:00:00Z");
    for (; d.toISOString().slice(0, 7) <= day(0).slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) keys.push(d.toISOString().slice(0, 7));
  }
  const bucket = (col: string) => (unit === "week" ? `date(substr(${col},1,10), 'weekday 0', '-6 days')` : `substr(${col},1,7)`);
  const series = (object: string, dateCol: string, filters: Filter[]): Map<string, number> => {
    const w = W(object, [...filters, ...acct(object)]);
    const rows = db.prepare(`SELECT ${bucket(dateCol)} k, COUNT(*) c FROM srecords WHERE ${w.sql} AND substr(${dateCol},1,10) >= ? GROUP BY k`)
      .all(...w.params, from) as { k: string; c: number }[];
    return new Map(rows.map((r) => [r.k, r.c]));
  };
  const trend = (a: Map<string, number>, b: Map<string, number>): TrendPoint[] => keys.map((k) => ({ key: k, a: a.get(k) ?? 0, b: b.get(k) ?? 0 }));
  const CLOSED_COL = "json_extract(data,'$.closedDate')";

  /* ── headline numbers (current vs previous window) ── */
  const caseAcct = acct("case");
  const closedIn = (a: string, b: string) => cnt("case", [...range("closedDate", a, b), ...caseAcct]);
  const slaIn = (a: string, b: string) => {
    const base = [...range("closedDate", a, b), { field: "dueDate", op: "notempty" } as Filter, ...caseAcct];
    return { met: cnt("case", base, `AND ${CLOSED_COL} <= json_extract(data,'$.dueDate')`), all: cnt("case", base) };
  };
  const avgClose = (a: string, b: string): number | null => {
    const w = W("case", [...range("closedDate", a, b), ...caseAcct]);
    const r = db.prepare(`SELECT AVG(MAX(0, julianday(${CLOSED_COL}) - julianday(substr(createdAt,1,10)))) v FROM srecords WHERE ${w.sql}`).get(...w.params) as { v: number | null };
    return r.v == null ? null : Math.round(r.v * 10) / 10;
  };
  const reachedRate = (a: string, b: string) => {
    const base = range("interactionDate", a, b);
    return pct(cnt("engagement_log", [...base, { field: "outcome", op: "contains", value: "Reached" }]), cnt("engagement_log", base));
  };

  const gapAll = cnt("member_measure_status", acct("member_measure_status"));
  const gapClosedAll = cnt("member_measure_status", [{ field: "gapStatus", op: "eq", value: "Closed" }, ...acct("member_measure_status")]);
  const sla = slaIn(from, to), slaPrev = slaIn(prevFrom, from);
  const recertBase: Filter[] = [{ field: "recertCohort", op: "notempty" }, ...caseAcct];
  const recertAll = cnt("case", recertBase), recertDone = cnt("case", [...recertBase, { field: "status", op: "eq", value: "Closed" }]);

  const tiles: Tile[] = [
    { key: "open", label: "Open cases", value: cnt("case", [OPEN, ...caseAcct]), prev: null, unit: "count", good: "down", hint: "Cases not yet closed, right now" },
    { key: "overdue", label: "Overdue cases", value: cnt("case", [OPEN, { field: "dueDate", op: "overdue" }, ...caseAcct]), prev: null, unit: "count", good: "down", hint: "Open and past their due date" },
    { key: "closed", label: "Cases closed", value: closedIn(from, to), prev: closedIn(prevFrom, from), unit: "count", good: "up", hint: "Closed in the period vs the period before" },
    { key: "sla", label: "Closed on time", value: pct(sla.met, sla.all), prev: pct(slaPrev.met, slaPrev.all), unit: "pct", good: "up", hint: "Share of cases closed on or before their due date" },
    { key: "ttc", label: "Avg days to close", value: avgClose(from, to), prev: avgClose(prevFrom, from), unit: "days", good: "down", hint: "Created to closed, for cases closed in the period" },
    { key: "gaprate", label: "Care-gap closure rate", value: pct(gapClosedAll, gapAll), prev: null, unit: "pct", good: "up", hint: "Closed gaps ÷ all gaps" },
    { key: "gapsclosed", label: "Gaps closed", value: cnt("member_measure_status", [...range("closedDate", from, to), ...acct("member_measure_status")]),
      prev: cnt("member_measure_status", [...range("closedDate", prevFrom, from), ...acct("member_measure_status")]), unit: "count", good: "up", hint: "Care gaps closed in the period" },
    { key: "contact", label: "Member contact rate", value: reachedRate(from, to), prev: reachedRate(prevFrom, from), unit: "pct", good: "up", hint: "Outreach attempts where the member was reached" },
    { key: "attempts", label: "Outreach attempts", value: cnt("engagement_log", range("interactionDate", from, to)), prev: cnt("engagement_log", range("interactionDate", prevFrom, from)), unit: "count", good: "up", hint: "Engagement-log entries in the period" },
    { key: "recert", label: "Recert completed", value: pct(recertDone, recertAll), prev: null, unit: "pct", good: "up", hint: "Redetermination cases closed ÷ all with a recert cohort" },
    { key: "sdoh", label: "SDOH screenings", value: cnt("sdoh_assessment", [...range("assessmentDate", from, to), ...acct("sdoh_assessment")]),
      prev: cnt("sdoh_assessment", [...range("assessmentDate", prevFrom, from), ...acct("sdoh_assessment")]), unit: "count", good: "up", hint: "Assessments completed in the period" },
  ];

  /* ── care gaps ── */
  const byMeasure = rates("member_measure_status", "measure", [], [{ field: "gapStatus", op: "eq", value: "Closed" }]);
  const targets = new Map<string, number | null>();
  if (byMeasure.length) {
    const ids = byMeasure.map((m) => m.key).filter(Boolean);
    for (const r of db.prepare(`SELECT id, json_extract(data,'$.targetRate') t FROM srecords WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: string; t: number | null }[]) targets.set(r.id, r.t);
    for (const m of byMeasure) m.target = targets.get(m.key) ?? null;
  }
  const gapDone: Filter[] = [{ field: "gapStatus", op: "eq", value: "Closed" }];
  const gaps = {
    total: gapAll, closed: gapClosedAll, rate: pct(gapClosedAll, gapAll), byMeasure,
    byPlan: rates("member_measure_status", "healthPlan", [], gapDone), byChw: rates("member_measure_status", "ownerId", [], gapDone),
    bySource: group("member_measure_status", "closeSource", gapDone),
    trend: trend(series("member_measure_status", "createdAt", []), series("member_measure_status", CLOSED_COL, gapDone)),
  };

  /* ── cases ── */
  const aw = W("case", [OPEN, ...caseAcct]);
  const aging = db.prepare(`SELECT CASE WHEN d <= 7 THEN '0–7 days' WHEN d <= 14 THEN '8–14 days' WHEN d <= 30 THEN '15–30 days' ELSE 'Over 30 days' END b, COUNT(*) c
    FROM (SELECT CAST(julianday('now') - julianday(substr(createdAt,1,10)) AS INTEGER) d FROM srecords WHERE ${aw.sql}) GROUP BY b`).all(...aw.params) as { b: string; c: number }[];
  const agingMap = new Map(aging.map((r) => [r.b, r.c]));
  const openByOwner = group("case", "ownerId", [OPEN], 40);
  const overdueByOwner = new Map(group("case", "ownerId", [OPEN, { field: "dueDate", op: "overdue" }], 40).map((g) => [g.key, g.value]));
  const cases = {
    byStatus: group("case", "status", []),
    byType: group("case", "type", [OPEN]),
    aging: ["0–7 days", "8–14 days", "15–30 days", "Over 30 days"].map((l) => ({ key: l, label: l, value: agingMap.get(l) ?? 0 })),
    workload: openByOwner.map((g) => ({ key: g.key, label: g.label, open: g.value, overdue: overdueByOwner.get(g.key) ?? 0 })),
    trend: trend(series("case", "createdAt", []), series("case", CLOSED_COL, [{ field: "status", op: "eq", value: "Closed" }])),
  };

  /* ── redetermination ── */
  const recert = {
    byCohort: rates("case", "recertCohort", [{ field: "recertCohort", op: "notempty" }], [{ field: "status", op: "eq", value: "Closed" }]),
    due: [7, 14, 30].map((n) => ({ key: String(n), label: `Next ${n} days`, value: cnt("case", [OPEN, { field: "recertDueDate", op: "nextDays", value: String(n) }, ...caseAcct]) })),
    overdueOpen: cnt("case", [OPEN, { field: "recertDueDate", op: "overdue" }, ...caseAcct]),
  };

  /* ── outreach ── */
  const inP = range("interactionDate", from, to);
  const outreach = {
    outcomes: group("engagement_log", "outcome", inP),
    byChw: rates("engagement_log", "ownerId", inP, [{ field: "outcome", op: "contains", value: "Reached" }]),
    byChannel: group("engagement_log", "channel", inP),
    trend: trend(series("engagement_log", "json_extract(data,'$.interactionDate')", []),
      series("engagement_log", "json_extract(data,'$.interactionDate')", [{ field: "outcome", op: "contains", value: "Reached" }])),
  };

  /* ── SDOH ── */
  const sp = [...range("assessmentDate", from, to), ...acct("sdoh_assessment")];
  const sw = W("sdoh_assessment", sp);
  const needRows = db.prepare(`SELECT j.value need, COUNT(*) c FROM srecords, json_each(srecords.data, '$.unmetNeeds') j WHERE ${sw.sql} GROUP BY need ORDER BY c DESC`).all(...sw.params) as { need: string; c: number }[];
  const sdoh = {
    screenings: cnt("sdoh_assessment", sp), declined: cnt("sdoh_assessment", [...sp, { field: "declined", op: "eq", value: "true" }]),
    needs: needRows.map((r) => ({ key: r.need, label: r.need, value: r.c })),
    referrals: group("sdoh_assessment", "referralStatus", range("assessmentDate", from, to)),
    housing: group("sdoh_assessment", "housingStatus", range("assessmentDate", from, to)),
  };

  return { period: { days, from, to: day(0), unit }, tiles, gaps, cases, recert, outreach, sdoh };
}
