"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Phone } from "lucide-react";
import { Card } from "@/components/ui";
import { OutreachModal } from "@/components/outreach-modal";
import { api, fmtDate } from "@/components/records";

type Item = {
  caseId: string; caseName: string; contactId: string | null; contactName: string | null; phone: string | null; language: string | null;
  priority: string | null; dueDate: string | null; recertDueDate: string | null; recertCohort: string | null; attempts: number; lastOutreach: string | null;
  engagementStatus: string | null; gaps: Array<{ id: string; measure: string }>; reasons: string[];
};
type Data = { stats: { openCases: number; callList: number; doneToday: number; openGaps: number; recertSoon: number; followUpsDue: number }; callList: Item[]; others: Item[] };

function Row({ it, onLog }: { it: Item; onLog: (i: Item) => void }) {
  return (
    <li className="grid gap-3 py-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/o/case/${it.caseId}`} className="font-semibold text-forest-800 hover:underline">{it.contactName ?? it.caseName}</Link>
          {it.phone && <a href={`tel:${it.phone}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><Phone className="size-3.5" />{it.phone}</a>}
          {it.language && it.language !== "English" && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{it.language}</span>}
          {it.priority && ["Urgent", "High"].includes(it.priority) && <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{it.priority}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {it.reasons.map((r) => <span key={r} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${/Overdue|past due|Follow-up/.test(r) ? "bg-red-50 text-red-700" : /Recert|Due/.test(r) ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{r}</span>)}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          {it.gaps.length > 0 && <>Gaps: <b>{[...new Set(it.gaps.map((g) => g.measure))].join(", ")}</b> · </>}
          {it.recertDueDate && <>Recert due {fmtDate(it.recertDueDate)}{it.recertCohort ? ` (${it.recertCohort.replace("_", " ")})` : ""} · </>}
          {it.attempts} attempt{it.attempts === 1 ? "" : "s"}{it.lastOutreach ? `, last ${fmtDate(it.lastOutreach)}` : ""}{it.engagementStatus ? ` · ${it.engagementStatus}` : ""}
        </p>
      </div>
      <button onClick={() => onLog(it)} className="flex h-9 items-center gap-2 rounded-xl bg-lime px-4 text-sm font-semibold text-forest-950 hover:bg-lime-hover">Log outreach</button>
    </li>
  );
}

export default function MyDayPage() {
  const [d, setD] = useState<Data | null>(null);
  const [log, setLog] = useState<Item | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<Data>("/api/my-day").then((r) => (r.ok ? setD(r.data) : setErr(r.message))); }, []);
  useEffect(load, [load]);

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!d) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  const s = d.stats;
  const tiles = [["To call today", s.callList], ["Done today", s.doneToday], ["Follow-ups due", s.followUpsDue], ["Recerts due in 14 days", s.recertSoon], ["My open gaps", s.openGaps], ["My open cases", s.openCases]];

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">My day</h1>
        <p className="mt-1 text-sm text-gray-500">Your cases ranked by what needs attention first: overdue, recert deadlines, follow-ups you promised, and members nobody has called yet.</p>
      </Card>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([k, v]) => <div key={String(k)} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</p><p className="mt-2 text-3xl font-bold tabular-nums">{v}</p></div>)}
      </div>
      {msg && <p className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700"><CheckCircle2 className="size-4" />{msg}</p>}
      <Card className="p-6">
        <h2 className="mb-1 font-semibold">Call list ({d.callList.length})</h2>
        {d.callList.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">Nothing urgent — you&apos;re caught up.</p> : <ul className="divide-y divide-gray-100">{d.callList.map((i) => <Row key={i.caseId} it={i} onLog={setLog} />)}</ul>}
      </Card>
      {d.others.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-1 font-semibold">Everything else assigned to me</h2>
          <ul className="divide-y divide-gray-100">{d.others.map((i) => <Row key={i.caseId} it={i} onLog={setLog} />)}</ul>
        </Card>
      )}
      {log && <OutreachModal caseId={log.caseId} caseName={log.contactName ?? log.caseName} onClose={() => setLog(null)}
        onSaved={(st) => { setMsg(`Outreach logged — engagement status is now “${st}”.`); setLog(null); load(); }} />}
    </div>
  );
}
