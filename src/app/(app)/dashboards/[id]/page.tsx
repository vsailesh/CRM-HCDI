"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { BarList, Donut, type Group } from "@/components/charts";
import {
  FilterEditor, Modal, api, btnDanger, btnGhost, btnPrimary, groupOptions, inputCls, numericFields,
  type Filter, type Meta, type RecordRow, type SField, type SObject,
} from "@/components/records";

type Result = { error?: string; total?: number; count?: number; groups?: Group[]; rows?: RecordRow[]; listFields?: string[] };
type Widget = {
  id: string; type: "metric" | "bar" | "donut" | "table"; title: string; object: string; filters: Filter[];
  groupBy?: string; metric?: "count" | "sum" | "avg" | "min" | "max"; metricField?: string; limit?: number; width?: 1 | 2; result?: Result;
};
type Dash = { id: string; name: string; description: string | null; widgets: Widget[] };

const blank = (object: string): Widget => ({ id: `w_${Math.random().toString(36).slice(2, 10)}`, type: "metric", title: "", object, filters: [], metric: "count", width: 1 });

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<Dash | null>(null);
  const [objects, setObjects] = useState<SObject[]>([]);
  const [fieldsBy, setFieldsBy] = useState<Record<string, SField[]>>({});
  const [editing, setEditing] = useState(false);
  const [wiz, setWiz] = useState<Widget | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await api<Dash>(`/api/dashboards/${id}`);
    if (!r.ok) return setErr(r.message);
    setD(r.data);
  }, [id]);
  useEffect(() => { load(); api<(SObject & { count: number })[]>("/api/objects").then((r) => r.ok && setObjects(r.data)); }, [load]);

  async function fields(object: string) {
    if (fieldsBy[object]) return fieldsBy[object];
    const r = await api<Meta>(`/api/objects/${object}`);
    if (r.ok) setFieldsBy((p) => ({ ...p, [object]: r.data.fields }));
    return r.data?.fields ?? [];
  }
  useEffect(() => { if (wiz) fields(wiz.object); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wiz?.object]);

  async function persist(widgets: Widget[]) {
    const clean = widgets.map(({ result: _r, ...w }) => w);
    const r = await api(`/api/dashboards/${id}`, "PATCH", { widgets: clean });
    if (!r.ok) return r.message;
    await load();
    return "";
  }
  const move = (i: number, by: number) => {
    if (!d) return; const w = [...d.widgets]; const j = i + by; if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j], w[i]]; persist(w);
  };
  async function remove() {
    if (!confirm("Delete this dashboard?")) return;
    const r = await api(`/api/dashboards/${id}`, "DELETE");
    if (r.ok) router.push("/dashboards"); else setErr(r.message);
  }
  async function saveWidget() {
    if (!d || !wiz) return;
    const w = { ...wiz, title: wiz.title.trim() || "Untitled" };
    const exists = d.widgets.some((x) => x.id === w.id);
    const msg = await persist(exists ? d.widgets.map((x) => (x.id === w.id ? w : x)) : [...d.widgets, w]);
    if (msg) setErr(msg); else { setWiz(null); setErr(""); }
  }

  if (!d) return <div className="p-6 text-sm text-gray-400">{err || "Loading…"}</div>;

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Link href="/dashboards" className="text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700">Dashboards</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{d.name}</h1>
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={load}><RefreshCw className="size-4" /> Refresh</button>
          <button className={btnGhost} onClick={() => setEditing(!editing)}><Pencil className="size-4" /> {editing ? "Done" : "Edit"}</button>
          {editing && <button className={btnPrimary} onClick={() => setWiz(blank(objects[0]?.api ?? "case"))}><Plus className="size-4" /> Add widget</button>}
          {editing && <button className={btnDanger} onClick={remove}><Trash2 className="size-4" /></button>}
        </div>
      </Card>
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {d.widgets.map((w, i) => (
          <Card key={w.id} className={`p-5 ${w.type === "metric" ? "" : w.width === 2 || w.type === "table" ? "md:col-span-2 xl:col-span-2" : "md:col-span-1 xl:col-span-2"}`}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-600">{w.title}</h2>
              {editing && (
                <div className="flex shrink-0 gap-0.5">
                  <button aria-label="Move up" onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded-md text-gray-400 hover:bg-gray-100"><ArrowUp className="size-3.5" /></button>
                  <button aria-label="Move down" onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded-md text-gray-400 hover:bg-gray-100"><ArrowDown className="size-3.5" /></button>
                  <button aria-label="Edit widget" onClick={() => setWiz({ ...w })} className="grid size-7 place-items-center rounded-md text-gray-400 hover:bg-gray-100"><Pencil className="size-3.5" /></button>
                  <button aria-label="Remove widget" onClick={() => persist(d.widgets.filter((x) => x.id !== w.id))} className="grid size-7 place-items-center rounded-md text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button>
                </div>
              )}
            </div>
            <WidgetBody w={w} />
          </Card>
        ))}
        {d.widgets.length === 0 && <p className="col-span-full py-16 text-center text-sm text-gray-400">This dashboard is empty. Click Edit, then Add widget.</p>}
      </div>

      {wiz && <WidgetModal w={wiz} set={setWiz} objects={objects} fields={fieldsBy[wiz.object] ?? []} onSave={saveWidget} err={err} />}
    </div>
  );
}

function WidgetBody({ w }: { w: Widget }) {
  const r = w.result;
  if (!r) return null;
  if (r.error) return <p className="text-sm text-red-600">{r.error}</p>;
  if (w.type === "metric") {
    const metricLabel = w.metric && w.metric !== "count" ? `${w.metric} of ${w.metricField}` : "records";
    return <><p className="text-4xl font-bold tracking-tight">{(r.total ?? 0).toLocaleString()}</p><p className="mt-1 text-xs text-gray-400">{metricLabel}</p></>;
  }
  if (w.type === "bar") return <BarList groups={r.groups ?? []} />;
  if (w.type === "donut") return <Donut groups={r.groups ?? []} />;
  return (
    <ul className="divide-y divide-gray-50 text-sm">
      {(r.rows ?? []).map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
          <Link href={`/o/${row.object}/${row.id}`} className="truncate font-semibold text-forest-800 hover:underline">{row.name}</Link>
          <span className="shrink-0 text-xs text-gray-500">{row.values.status ? String(row.values.status) : row.values.priority ? String(row.values.priority) : ""}</span>
        </li>
      ))}
      {!r.rows?.length && <li className="py-6 text-center text-gray-400">No records</li>}
    </ul>
  );
}

function WidgetModal({ w, set, objects, fields, onSave, err }: {
  w: Widget; set: (w: Widget | null) => void; objects: SObject[]; fields: SField[]; onSave: () => void; err: string;
}) {
  const up = (p: Partial<Widget>) => set({ ...w, ...p });
  const groups = groupOptions(fields);
  return (
    <Modal title={w.title ? "Edit widget" : "Add widget"} onClose={() => set(null)} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-semibold text-gray-600">Title</span>
          <input className={inputCls} value={w.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Type</span>
          <select className={inputCls} value={w.type} onChange={(e) => up({ type: e.target.value as Widget["type"], groupBy: e.target.value === "metric" || e.target.value === "table" ? undefined : w.groupBy ?? groups[0]?.value })}>
            <option value="metric">Metric (single number)</option><option value="bar">Bar chart</option><option value="donut">Donut chart</option><option value="table">Recent records</option>
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Object</span>
          <select className={inputCls} value={w.object} onChange={(e) => up({ object: e.target.value, filters: [], groupBy: undefined, metricField: undefined })}>
            {objects.map((o) => <option key={o.api} value={o.api}>{o.plural}</option>)}
          </select></label>
        {(w.type === "bar" || w.type === "donut") && (
          <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Group by</span>
            <select className={inputCls} value={w.groupBy ?? ""} onChange={(e) => up({ groupBy: e.target.value })}>
              <option value="" disabled>Choose…</option>{groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select></label>
        )}
        {w.type !== "table" && (
          <>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Measure</span>
              <select className={inputCls} value={w.metric ?? "count"} onChange={(e) => up({ metric: e.target.value as Widget["metric"] })}>
                <option value="count">Count of records</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Min</option><option value="max">Max</option>
              </select></label>
            {w.metric && w.metric !== "count" && (
              <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Numeric field</span>
                <select className={inputCls} value={w.metricField ?? ""} onChange={(e) => up({ metricField: e.target.value })}>
                  <option value="" disabled>Choose…</option>{numericFields(fields).map((f) => <option key={f.api} value={f.api}>{f.label}</option>)}
                </select></label>
            )}
          </>
        )}
        {w.type !== "metric" && (
          <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Width</span>
            <select className={inputCls} value={w.width ?? 1} onChange={(e) => up({ width: Number(e.target.value) as 1 | 2 })}><option value={1}>Standard</option><option value={2}>Wide</option></select></label>
        )}
      </div>
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold text-gray-600">Filters (all must match)</p>
        <FilterEditor fields={fields} filters={w.filters} onChange={(f) => up({ filters: f })} />
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button className={btnGhost} onClick={() => set(null)}>Cancel</button>
        <button className={btnPrimary} onClick={onSave}>Save widget</button>
      </div>
    </Modal>
  );
}

