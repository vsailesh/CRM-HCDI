"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Play, Scale } from "lucide-react";
import { Card } from "@/components/ui";
import { api, btnGhost, btnPrimary, inputCls } from "@/components/records";

type Member = { id: string; name: string; available: boolean; open: number; overdue: number; untouched: number };
type Load = { staff: Member[]; unassigned: { open: number; untouched: number } };
type Plan = { staff: Array<{ id: string; name: string; before: number; added: number; after: number }>; moveCount: number; candidates: number; households: number; unplaceable: number; applied?: { batchId: string; assigned: number; failed: number } };
const STATUSES = ["New", "In Progress", "Waiting on Member", "Waiting on Provider", "Escalated"];
const LANGS = ["Spanish", "Chinese"];

export default function WorkloadPage() {
  const [load, setLoad] = useState<Load | null>(null);
  const [from, setFrom] = useState("");
  const [statuses, setStatuses] = useState<string[]>(["New"]);
  const [pool, setPool] = useState<string[]>([]);
  const [langPools, setLangPools] = useState<Record<string, string[]>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => { api<Load>("/api/workload").then((r) => (r.ok ? setLoad(r.data) : setErr(r.message))); }, []);
  useEffect(refresh, [refresh]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const body = (apply: boolean) => ({ fromOwner: from || null, statuses, pool, apply, languagePools: Object.fromEntries(Object.entries(langPools).filter(([, v]) => v.length)) });

  async function run(apply: boolean) {
    setBusy(true); setErr("");
    const r = await api<Plan>("/api/workload", "POST", body(apply));
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setPlan(r.data);
    if (apply) refresh();
  }

  if (err && !load) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!load) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  const max = Math.max(1, ...load.staff.map((s) => s.open), load.unassigned.open);

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Workload</h1>
        <p className="mt-1 text-sm text-gray-500">See who is carrying what, and rebalance cases across the team. Households stay together; languages can be reserved for specific staff.</p>
      </Card>

      <Card className="p-6">
        <h2 className="mb-3 font-semibold">Current caseload</h2>
        <ul className="space-y-2">
          {[{ id: "", name: "Unassigned", open: load.unassigned.open, overdue: 0, untouched: load.unassigned.untouched, available: true }, ...load.staff].map((s) => (
            <li key={s.id || "none"} className="grid grid-cols-[minmax(0,11rem)_1fr_11rem] items-center gap-3 text-sm">
              <span className={`truncate ${s.available ? "text-gray-700" : "text-gray-400"}`}>{s.name}{!s.available && " (away)"}</span>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${s.name}: ${s.open} open`}><div className="h-full rounded-full" style={{ width: `${(s.open / max) * 100}%`, background: s.id ? "#2f6f9f" : "#8a8f98" }} /></div>
              <span className="text-right tabular-nums"><b>{s.open}</b> open{s.overdue > 0 && <span className="ml-2 text-xs text-red-600">{s.overdue} overdue</span>}<span className="ml-2 text-xs text-gray-400">{s.untouched} new</span></span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="flex items-center gap-2 font-semibold"><Scale className="size-4" /> Rebalance cases</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Take cases from</span>
            <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Unassigned (no owner)</option>
              {load.staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.open} open)</option>)}
            </select>
          </label>
          <fieldset className="text-sm"><legend className="mb-1 block text-xs font-semibold uppercase text-gray-500">With status</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{STATUSES.map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" className="size-4 accent-lime" checked={statuses.includes(s)} onChange={() => setStatuses(toggle(statuses, s))} />{s}</label>)}</div>
          </fieldset>
        </div>
        <fieldset className="text-sm"><legend className="mb-1 block text-xs font-semibold uppercase text-gray-500">Give cases to</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {load.staff.filter((s) => s.id !== from).map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" className="size-4 accent-lime" checked={pool.includes(s.id)} onChange={() => setPool(toggle(pool, s.id))} />{s.name}</label>)}
            <button type="button" className="text-xs font-medium text-forest-800 hover:underline" onClick={() => setPool(load.staff.filter((s) => s.id !== from && s.available).map((s) => s.id))}>Select everyone available</button>
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          {LANGS.map((l) => (
            <fieldset key={l} className="rounded-xl bg-gray-50 p-3 text-sm"><legend className="px-1 text-xs font-semibold uppercase text-gray-500">{l}-speaking members go only to</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">{load.staff.filter((s) => pool.includes(s.id)).map((s) => <label key={s.id} className="flex items-center gap-1.5"><input type="checkbox" className="size-4 accent-lime" checked={(langPools[l] ?? []).includes(s.id)} onChange={() => setLangPools((p) => ({ ...p, [l]: toggle(p[l] ?? [], s.id) }))} />{s.name}</label>)}
                {pool.length === 0 && <span className="text-xs text-gray-400">Pick who receives cases first</span>}</div>
              <p className="mt-1 text-xs text-gray-400">Leave empty for no restriction.</p>
            </fieldset>
          ))}
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} disabled={busy || pool.length === 0} onClick={() => run(false)}><Play className="size-4" /> Preview</button>
          <button className={btnPrimary} disabled={busy || !plan || plan.moveCount === 0 || !!plan.applied} onClick={() => run(true)}>Assign {plan?.moveCount ?? 0} cases</button>
        </div>
        {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
        {plan && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">{plan.candidates} case{plan.candidates === 1 ? "" : "s"} found{plan.households ? `, ${plan.households} household${plan.households === 1 ? "" : "s"} kept together` : ""}.{plan.unplaceable ? ` ${plan.unplaceable} could not be placed (no one in the language pool).` : ""}</p>
            <table className="w-full max-w-xl text-left text-sm"><thead className="text-xs uppercase text-gray-500"><tr><th className="py-1.5">Team member</th><th className="text-right">Before</th><th className="text-right">Adding</th><th className="text-right">After</th></tr></thead>
              <tbody className="divide-y divide-gray-50">{plan.staff.map((s) => <tr key={s.id}><td className="py-1.5">{s.name}</td><td className="text-right tabular-nums">{s.before}</td><td className="text-right tabular-nums text-forest-800">+{s.added}</td><td className="text-right font-semibold tabular-nums">{s.after}</td></tr>)}</tbody></table>
            {plan.applied && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">Assigned {plan.applied.assigned} cases. <Link href="/data/history" className="underline">Undo from Batches</Link></p>}
          </div>
        )}
      </Card>
    </div>
  );
}
