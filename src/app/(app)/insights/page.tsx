"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui";
import { BarList, KpiTile, RateBars, TrendChart, type Group, type RateRow, type TrendPoint } from "@/components/charts";
import { api, btnGhost, csvCell, inputCls } from "@/components/records";

type Row = { key: string; label: string; value: number };
type Kpis = {
  period: { days: number; from: string; to: string; unit: "week" | "month" };
  tiles: Array<{ key: string; label: string; value: number | null; prev: number | null; unit: "count" | "pct" | "days"; good: "up" | "down"; hint: string }>;
  gaps: { total: number; closed: number; rate: number | null; byMeasure: RateRow[]; byPlan: RateRow[]; byChw: RateRow[]; bySource: Row[]; trend: TrendPoint[] };
  cases: { byStatus: Row[]; byType: Row[]; aging: Row[]; workload: Array<{ key: string; label: string; open: number; overdue: number }>; trend: TrendPoint[] };
  recert: { byCohort: RateRow[]; due: Row[]; overdueOpen: number };
  outreach: { outcomes: Row[]; byChw: RateRow[]; byChannel: Row[]; trend: TrendPoint[] };
  sdoh: { screenings: number; declined: number; needs: Row[]; referrals: Row[]; housing: Row[] };
};
const asGroups = (r: Row[]): Group[] => r.map((x) => ({ ...x, count: x.value }));
const PERIODS = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [180, "Last 6 months"], [365, "Last 12 months"]] as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <section className="space-y-3"><div><h2 className="text-lg font-bold tracking-tight">{title}</h2>{sub && <p className="text-sm text-gray-500">{sub}</p>}</div><div className="grid gap-5 lg:grid-cols-2">{children}</div></section>;
}
function Panel({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  return <Card className={`p-5 ${wide ? "lg:col-span-2" : ""}`}><h3 className="text-sm font-semibold text-gray-700">{title}</h3>{note && <p className="mb-3 text-xs text-gray-400">{note}</p>}<div className={note ? "" : "mt-3"}>{children}</div></Card>;
}

export default function InsightsPage() {
  const [days, setDays] = useState(30);
  const [account, setAccount] = useState("");
  const [plans, setPlans] = useState<Array<{ id: string; name: string }>>([]);
  const [k, setK] = useState<Kpis | null>(null);
  const [err, setErr] = useState("");
  const [role, setRole] = useState("");
  const [card, setCard] = useState<{ people: number; rows: Array<{ key: string; label: string; unit: "count" | "pct" | "days"; good: "up" | "down"; mine: number | null; teamAvg: number | null }> } | null>(null);

  useEffect(() => { api<{ role: string }>("/api/auth/me").then((r) => r.ok && setRole(r.data.role)); }, []);
  useEffect(() => {
    if (role && role !== "admin") api<NonNullable<typeof card>>(`/api/kpis/scorecard?days=${days}`).then((r) => r.ok && setCard(r.data));
  }, [role, days]);
  useEffect(() => {
    api<{ data: Array<{ id: string; name: string; values: Record<string, unknown> }> }>(`/api/records/account?limit=200&filters=${encodeURIComponent(JSON.stringify([{ field: "type", op: "eq", value: "Health Plan" }]))}`)
      .then((r) => r.ok && setPlans(r.data.data.map((a) => ({ id: a.id, name: a.name }))));
  }, []);
  const load = useCallback(() => {
    setErr("");
    api<Kpis>(`/api/kpis?days=${days}${account ? `&account=${account}` : ""}`).then((r) => (r.ok ? setK(r.data) : setErr(r.message)));
  }, [days, account]);
  useEffect(load, [load]);

  function exportCsv() {
    if (!k) return;
    const lines: unknown[][] = [["Section", "Item", "Value", "Previous period"]];
    k.tiles.forEach((t) => lines.push(["Headline", t.label, t.value, t.prev]));
    k.gaps.byMeasure.forEach((m) => lines.push(["Care gaps by measure", m.label, `${m.rate}% (${m.done}/${m.total})`, m.target ?? ""]));
    k.gaps.byChw.forEach((m) => lines.push(["Care gaps by CHW", m.label, `${m.rate}% (${m.done}/${m.total})`, ""]));
    k.cases.workload.forEach((w) => lines.push(["Open cases by owner", w.label, w.open, `overdue ${w.overdue}`]));
    k.outreach.byChw.forEach((m) => lines.push(["Contact rate by CHW", m.label, `${m.rate}% (${m.done}/${m.total})`, ""]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `kpis-${k.period.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-8 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">KPI Center</h1>
          <p className="mt-1 text-sm text-gray-500">Care gaps, case flow, redetermination, outreach and social needs — for the records you have access to.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={`${inputCls} !w-44`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{PERIODS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select>
          <select className={`${inputCls} !w-52`} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Health plan"><option value="">All health plans</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className={btnGhost} onClick={load}><RefreshCw className="size-4" /> Refresh</button>
          <button className={btnGhost} onClick={exportCsv} disabled={!k}><Download className="size-4" /> Export</button>
        </div>
      </Card>
      {card && (
        <Card className="p-6">
          <h2 className="text-lg font-bold tracking-tight">My numbers vs team average</h2>
          <p className="mb-4 text-sm text-gray-500">Team average = team total ÷ {card.people} people carrying cases (rates and averages are team-wide). Counts only.</p>
          <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {card.rows.map((r) => {
              const f = (v: number | null) => (v == null ? "—" : r.unit === "pct" ? `${v}%` : r.unit === "days" ? `${v}d` : String(v));
              const diff = r.mine != null && r.teamAvg != null ? r.mine - r.teamAvg : null;
              const better = diff == null || Math.abs(diff) < 0.05 ? null : (diff > 0) === (r.good === "up");
              return (
                <div key={r.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-gray-50 py-2 text-sm">
                  <span className="text-gray-600">{r.label}</span>
                  <span className="w-16 text-right font-bold tabular-nums">{f(r.mine)}</span>
                  <span className={`w-28 text-right text-xs tabular-nums ${better == null ? "text-gray-400" : better ? "text-green-700" : "text-red-600"}`}>team {f(r.teamAvg)} {better == null ? "" : better ? "▲ better" : "▼ behind"}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
      {!k && !err && <p className="text-sm text-gray-400">Calculating…</p>}

      {k && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">{k.tiles.map(({ key, ...t }) => <KpiTile key={key} {...t} />)}</div>

          <Section title="Care gaps" sub={`${k.gaps.closed.toLocaleString()} of ${k.gaps.total.toLocaleString()} gaps closed${k.gaps.rate != null ? ` (${k.gaps.rate}%)` : ""}. Tick marks show each measure's target rate.`}>
            <Panel title="Closure rate by measure" note="Closed gaps ÷ all gaps, per HEDIS measure"><RateBars rows={k.gaps.byMeasure} doneLabel="closed" /></Panel>
            <Panel title="Gaps opened vs closed" note={`Per ${k.period.unit}`}><TrendChart points={k.gaps.trend} aLabel="Opened" bLabel="Closed" unit={k.period.unit} /></Panel>
            <Panel title="Closure rate by health plan"><RateBars rows={k.gaps.byPlan} doneLabel="closed" /></Panel>
            <Panel title="Closure rate by CHW"><RateBars rows={k.gaps.byChw} doneLabel="closed" /></Panel>
            <Panel title="How closed gaps were closed"><BarList groups={asGroups(k.gaps.bySource)} /></Panel>
          </Section>

          <Section title="Cases" sub="Flow, ageing and who is carrying the load.">
            <Panel title="Cases opened vs closed" note={`Per ${k.period.unit}`}><TrendChart points={k.cases.trend} aLabel="Opened" bLabel="Closed" unit={k.period.unit} /></Panel>
            <Panel title="Open case ageing" note="Days since the case was created"><BarList groups={asGroups(k.cases.aging)} /></Panel>
            <Panel title="Open cases by type"><BarList groups={asGroups(k.cases.byType)} /></Panel>
            <Panel title="All cases by status"><BarList groups={asGroups(k.cases.byStatus)} /></Panel>
            <Panel title="Caseload by owner" note="Open cases, with how many are overdue" wide>
              {k.cases.workload.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">No open cases</p> : (
                <ul className="space-y-2">
                  {(() => { const max = Math.max(1, ...k.cases.workload.map((w) => w.open)); return k.cases.workload.map((w) => (
                    <li key={w.key} className="grid grid-cols-[minmax(0,10rem)_1fr_7rem] items-center gap-3 text-sm">
                      <span className="truncate text-gray-600">{w.label}</span>
                      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${w.label}: ${w.open} open, ${w.overdue} overdue`}>
                        <div style={{ width: `${((w.open - w.overdue) / max) * 100}%`, background: "#2f6f9f" }} />
                        <div style={{ width: `${(w.overdue / max) * 100}%`, background: "#c2455f", marginLeft: 2 }} />
                      </div>
                      <span className="text-right tabular-nums"><b>{w.open}</b>{w.overdue > 0 && <span className="ml-1 text-xs text-red-600">{w.overdue} overdue</span>}</span>
                    </li>)); })()}
                </ul>
              )}
              <p className="mt-3 flex gap-4 text-xs text-gray-500"><span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "#2f6f9f" }} />On track</span><span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "#c2455f" }} />Overdue</span></p>
            </Panel>
          </Section>

          <Section title="Redetermination" sub={`${k.recert.overdueOpen} open case${k.recert.overdueOpen === 1 ? " is" : "s are"} past the recert due date.`}>
            <Panel title="Completed by cohort" note="Closed redetermination cases ÷ all in the cohort"><RateBars rows={k.recert.byCohort} doneLabel="completed" /></Panel>
            <Panel title="Open cases with a recert due soon"><BarList groups={asGroups(k.recert.due)} /></Panel>
          </Section>

          <Section title="Member outreach" sub="Engagement-log activity in the period.">
            <Panel title="Attempts and members reached" note={`Per ${k.period.unit}`}><TrendChart points={k.outreach.trend} aLabel="Attempts" bLabel="Reached" unit={k.period.unit} /></Panel>
            <Panel title="Outcomes"><BarList groups={asGroups(k.outreach.outcomes)} /></Panel>
            <Panel title="Contact rate by CHW" note="Attempts where the member was reached"><RateBars rows={k.outreach.byChw} doneLabel="reached" /></Panel>
            <Panel title="Channels"><BarList groups={asGroups(k.outreach.byChannel)} /></Panel>
          </Section>

          <Section title="Social needs (SDOH)" sub={`${k.sdoh.screenings} screening${k.sdoh.screenings === 1 ? "" : "s"} in the period${k.sdoh.declined ? `, ${k.sdoh.declined} declined` : ""}.`}>
            <Panel title="Unmet needs identified"><BarList groups={asGroups(k.sdoh.needs)} /></Panel>
            <Panel title="Referral status"><BarList groups={asGroups(k.sdoh.referrals)} /></Panel>
            <Panel title="Housing situation"><BarList groups={asGroups(k.sdoh.housing)} /></Panel>
          </Section>
        </>
      )}
    </div>
  );
}
