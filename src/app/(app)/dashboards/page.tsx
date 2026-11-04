"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Modal, api, btnGhost, btnPrimary, fmtDateTime, inputCls } from "@/components/records";

type Dash = { id: string; name: string; description: string | null; updatedAt: string; widgetCount: number; createdByName: string | null };

const TEMPLATES = [
  { id: "cases", label: "Case operations", hint: "Open, overdue and urgent cases; status, type and owner breakdowns" },
  { id: "hedis", label: "HEDIS outreach", hint: "Measures, providers, chart retrieval and redetermination call outcomes" },
  { id: "blank", label: "Blank", hint: "Start empty and add your own widgets" },
];

export default function DashboardsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Dash[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("cases");
  const [err, setErr] = useState("");

  useEffect(() => { api<Dash[]>("/api/dashboards").then((r) => r.ok && setRows(r.data)); }, []);

  async function create() {
    const r = await api("/api/dashboards", "POST", { name, template });
    if (!r.ok) return setErr(r.message);
    router.push(`/dashboards/${r.data.id}`);
  }

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-gray-500">Live metrics and charts built from any object.</p>
        </div>
        <button className={btnPrimary} onClick={() => { setOpen(true); setErr(""); }}><Plus className="size-4" /> New Dashboard</button>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((d) => (
          <Link key={d.id} href={`/dashboards/${d.id}`} className="rounded-3xl border border-gray-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-lime-soft text-forest-800"><LayoutDashboard className="size-5" /></span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{d.name}</p>
                <p className="text-xs text-gray-400">{d.widgetCount} widgets · {d.createdByName ?? "—"}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-400">Updated {fmtDateTime(d.updatedAt)}</p>
          </Link>
        ))}
        {rows.length === 0 && <p className="col-span-full py-12 text-center text-sm text-gray-400">No dashboards yet — create one to get started.</p>}
      </div>

      {open && (
        <Modal title="New Dashboard" onClose={() => setOpen(false)}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Name</span>
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="mt-4 space-y-2">
            <legend className="mb-1 text-xs font-semibold text-gray-600">Start from</legend>
            {TEMPLATES.map((t) => (
              <label key={t.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${template === t.id ? "border-forest-800 bg-lime-soft/40" : "border-gray-200"}`}>
                <input type="radio" name="tpl" className="mt-1 accent-lime" checked={template === t.id} onChange={() => setTemplate(t.id)} />
                <span><span className="block text-sm font-semibold">{t.label}</span><span className="text-xs text-gray-500">{t.hint}</span></span>
              </label>
            ))}
          </fieldset>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} disabled={!name.trim()} onClick={create}>Create</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
