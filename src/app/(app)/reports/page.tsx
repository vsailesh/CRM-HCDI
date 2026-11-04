"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Play, Save, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { BarList, type Group } from "@/components/charts";
import {
  FieldValue, FilterEditor, api, btnDanger, btnGhost, btnPrimary, groupOptions, inputCls, numericFields,
  type Filter, type Meta, type RecordRow, type SField, type SObject,
} from "@/components/records";

type Config = { object: string; filters: Filter[]; groupBy?: string; metric?: string; metricField?: string };
type Saved = { id: string; name: string; config: Config };
type Out = { mode: "summary"; total: number; count: number; groups: Group[] } | { mode: "list"; rows: RecordRow[]; total: number };

export default function ReportsPage() {
  const [objects, setObjects] = useState<SObject[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [cfg, setCfg] = useState<Config>({ object: "case", filters: [], metric: "count" });
  const [fields, setFields] = useState<SField[]>([]);
  const [out, setOut] = useState<Out | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const refreshSaved = () => api<Saved[]>("/api/reports").then((r) => r.ok && setSaved(r.data));
  useEffect(() => { api<SObject[]>("/api/objects").then((r) => r.ok && setObjects(r.data)); refreshSaved(); }, []);
  useEffect(() => { api<Meta>(`/api/objects/${cfg.object}`).then((r) => r.ok && setFields(r.data.fields)); }, [cfg.object]);

  async function run(c = cfg) {
    setErr(""); setMsg("");
    const r = await api("/api/reports/run", "POST", c);
    if (!r.ok) { setOut(null); return setErr(r.message); }
    setOut(r.data);
  }
  async function save() {
    const r = await api("/api/reports", "POST", { name, config: cfg });
    if (!r.ok) return setErr(r.message);
    setName(""); setMsg("Report saved"); refreshSaved();
  }
  async function del(id: string) {
    if (!confirm("Delete this report?")) return;
    const r = await api(`/api/reports?id=${id}`, "DELETE");
    if (r.ok) refreshSaved(); else setErr(r.message);
  }
  async function exportCsv() {
    const r = await api("/api/reports/run", "POST", { ...cfg, groupBy: undefined, csv: true });
    if (!r.ok) return setErr(r.message);
    const cols = fields.filter((f) => f.type !== "textarea");
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = r.data.rows as RecordRow[];
    const csv = [["Record Name", ...cols.map((c) => c.label)].map(esc).join(","),
      ...rows.map((rec) => [rec.name, ...cols.map((c) => (c.type === "lookup" ? rec.refs[c.api] : Array.isArray(rec.values[c.api]) ? (rec.values[c.api] as string[]).join("; ") : rec.values[c.api]))].map(esc).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${cfg.object}-report.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const obj = objects.find((o) => o.api === cfg.object);
  const cols = (obj?.listFields ?? []).map((a) => fields.find((f) => f.api === a)).filter((f): f is SField => !!f);

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">Pick an object, filter it, and either list records or summarise them by a field.</p>
      </Card>

      <div className="grid gap-5 xl:grid-cols-4">
        <Card className="h-fit space-y-5 p-5 xl:col-span-1">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Object</span>
            <select className={inputCls} value={cfg.object} onChange={(e) => { setCfg({ object: e.target.value, filters: [], metric: "count" }); setOut(null); }}>
              {objects.map((o) => <option key={o.api} value={o.api}>{o.plural}</option>)}
            </select></label>
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-600">Filters</p>
            <FilterEditor fields={fields} filters={cfg.filters} onChange={(f) => setCfg({ ...cfg, filters: f })} />
          </div>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Summarise by</span>
            <select className={inputCls} value={cfg.groupBy ?? ""} onChange={(e) => setCfg({ ...cfg, groupBy: e.target.value || undefined })}>
              <option value="">None — list records</option>
              {groupOptions(fields).map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select></label>
          {cfg.groupBy && (
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Measure" className={inputCls} value={cfg.metric ?? "count"} onChange={(e) => setCfg({ ...cfg, metric: e.target.value })}>
                <option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Min</option><option value="max">Max</option>
              </select>
              {cfg.metric && cfg.metric !== "count" && (
                <select aria-label="Numeric field" className={inputCls} value={cfg.metricField ?? ""} onChange={(e) => setCfg({ ...cfg, metricField: e.target.value })}>
                  <option value="" disabled>Field…</option>{numericFields(fields).map((f) => <option key={f.api} value={f.api}>{f.label}</option>)}
                </select>
              )}
            </div>
          )}
          <button className={`${btnPrimary} w-full justify-center`} onClick={() => run()}><Play className="size-4" /> Run report</button>
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <input className={inputCls} placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className={`${btnGhost} w-full justify-center`} disabled={!name.trim()} onClick={save}><Save className="size-4" /> Save report</button>
          </div>
          {saved.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-gray-600">Saved reports</p>
              <ul className="space-y-1">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <button className="truncate text-left text-sm font-medium text-forest-800 hover:underline" onClick={() => { setCfg(s.config); run(s.config); }}>{s.name}</button>
                    <button aria-label={`Delete ${s.name}`} onClick={() => del(s.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5 xl:col-span-3">
          {err && <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
          {msg && <p className="mb-3 rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
          {!out && !err && <p className="py-16 text-center text-sm text-gray-400">Choose options and run the report.</p>}
          {out?.mode === "summary" && (
            <>
              <p className="mb-4 text-sm text-gray-500"><span className="text-2xl font-bold text-gray-900">{out.total.toLocaleString()}</span> {cfg.metric && cfg.metric !== "count" ? `${cfg.metric} of ${cfg.metricField}` : "records"} across {out.groups.length} groups</p>
              <BarList groups={out.groups} />
              <table className="mt-6 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100"><th className="py-2">Group</th><th className="py-2 text-right">Value</th><th className="py-2 text-right">Records</th></tr></thead>
                <tbody className="divide-y divide-gray-50">{out.groups.map((g) => <tr key={g.key}><td className="py-2">{g.label}</td><td className="py-2 text-right tabular-nums">{g.value.toLocaleString()}</td><td className="py-2 text-right tabular-nums">{g.count}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {out?.mode === "list" && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-gray-500"><span className="text-2xl font-bold text-gray-900">{out.total}</span> records{out.total > out.rows.length && ` (showing ${out.rows.length})`}</p>
                <button className={btnGhost} onClick={exportCsv}><Download className="size-4" /> Export CSV</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100">{cols.map((c) => <th key={c.api} className="whitespace-nowrap px-3 py-2">{c.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {out.rows.map((r) => (
                      <tr key={r.id}>{cols.map((c, i) => <td key={c.api} className="px-3 py-2">{i === 0 && c.type !== "lookup" ? <Link href={`/o/${r.object}/${r.id}`} className="font-semibold text-forest-800 hover:underline"><FieldValue f={c} rec={r} /></Link> : <FieldValue f={c} rec={r} />}</td>)}</tr>
                    ))}
                    {out.rows.length === 0 && <tr><td colSpan={cols.length} className="py-10 text-center text-gray-400">No matching records</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {out?.mode === "list" && <p className="mt-3 text-[11px] text-gray-400">CSV exports are recorded in the audit log.</p>}
        </Card>
      </div>
    </div>
  );
}
