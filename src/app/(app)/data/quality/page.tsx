"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Wand2 } from "lucide-react";
import { Card } from "@/components/ui";
import { api, btnGhost, inputCls, type SObject } from "@/components/records";

type FieldQ = { api: string; label: string; type: string; filled: number; pct: number; invalid: number; fixable: number };
type Dup = { field: string; label: string; groups: number; records: number; sample: { count: number; ids: string[] }[] };
type Q = { object: string; total: number; score: number; fields: FieldQ[]; duplicates: Dup[]; issues: { label: string; count: number; fixField?: string }[] };

const tone = (n: number) => (n >= 85 ? "text-green-700" : n >= 65 ? "text-amber-700" : "text-red-600");

export default function QualityPage() {
  const [objects, setObjects] = useState<SObject[]>([]);
  const [object, setObject] = useState("contact");
  const [q, setQ] = useState<Q | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { api<SObject[]>("/api/objects").then((r) => r.ok && setObjects(r.data)); }, []);
  const load = useCallback(() => {
    setQ(null); setErr("");
    api<Q>(`/api/data/quality?object=${object}`).then((r) => (r.ok ? setQ(r.data) : setErr(r.message)));
  }, [object]);
  useEffect(load, [load]);

  async function fix(field: string) {
    setMsg(""); setErr("");
    const r = await api("/api/data/quality", "POST", { object, field });
    if (!r.ok) return setErr(r.message);
    setMsg(r.message); load();
  }

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data quality</h1>
          <p className="mt-1 text-sm text-gray-500">Completeness, format problems and possible duplicates. Shows counts only — no member values.</p>
        </div>
        <select className={`${inputCls} !w-60`} value={object} onChange={(e) => setObject(e.target.value)} aria-label="Object">
          {objects.map((o) => <option key={o.api} value={o.api}>{o.plural}</option>)}
        </select>
      </Card>
      {msg && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
      {!q && !err && <p className="text-sm text-gray-400">Scanning…</p>}

      {q && (
        <>
          <div className="grid gap-5 md:grid-cols-3">
            <Card className="p-6"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quality score</p><p className={`mt-2 text-5xl font-bold tabular-nums ${tone(q.score)}`}>{q.score}<span className="text-xl text-gray-400">/100</span></p><p className="mt-1 text-xs text-gray-400">Half completeness, half format validity, minus a duplicate penalty</p></Card>
            <Card className="p-6"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Records scanned</p><p className="mt-2 text-5xl font-bold tabular-nums">{q.total.toLocaleString()}</p></Card>
            <Card className="p-6"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open issues</p><p className="mt-2 text-5xl font-bold tabular-nums">{q.issues.length}</p></Card>
          </div>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Issues to fix</h2>
            {q.issues.length === 0 ? <p className="text-sm text-gray-500">Nothing found — this object looks clean.</p> : (
              <ul className="divide-y divide-gray-50">
                {q.issues.map((i, k) => (
                  <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span>{i.label}</span>
                    {i.fixField && <button className={`${btnGhost} !h-8 !px-3`} onClick={() => fix(i.fixField!)}><Wand2 className="size-3.5" /> Fix automatically</button>}
                  </li>
                ))}
              </ul>
            )}
            {q.duplicates.flatMap((d) => d.sample.slice(0, 3).map((s, i) => (
              <p key={`${d.field}${i}`} className="mt-2 text-xs text-gray-500">{d.label}: {s.count} records share a key — {s.ids.slice(0, 4).map((id, n) => <Link key={id} href={`/o/${object}/${id}`} className="mr-2 font-medium text-forest-800 hover:underline">record {n + 1}</Link>)}</p>
            ))).slice(0, 8)}
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Completeness by field</h2>
            <ul className="space-y-1.5">
              {q.fields.map((f) => (
                <li key={f.api} className="grid grid-cols-[minmax(0,12rem)_1fr_3rem_6rem] items-center gap-3 text-sm">
                  <span className="truncate text-gray-600" title={f.label}>{f.label}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${f.label}: ${f.pct}% filled`}><div className="h-full rounded-full" style={{ width: `${Math.max(1, f.pct)}%`, background: f.pct >= 85 ? "#6f9c2e" : f.pct >= 50 ? "#d9822b" : "#c2455f" }} /></div>
                  <span className="text-right font-semibold tabular-nums">{f.pct}%</span>
                  <span className="text-right text-xs text-red-600">{f.invalid ? `${f.invalid} invalid` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
