"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { api, btnGhost, btnPrimary, fmtDateTime, inputCls, type Meta, type SField } from "@/components/records";

type Cond = { field: string; op: "eq" | "ne" | "contains" | "empty" | "notempty"; value?: string };
type Rule = { id: string; name: string; enabled: boolean; conditions: Cond[]; mode: "staff" | "pool" | "auto"; staffId?: string; staffIds?: string[] };
type Assign = { enabled: boolean; rules: Rule[]; fallback: "auto" | "creator" };
type Policy = { priority: string; dueInDays: number; warnDaysBefore: number; escalateAfterDays: number };
type Sla = { enabled: boolean; policies: Policy[]; pauseStatuses: string[]; escalateTo: string };
type Staff = { id: string; name: string; isAvailable: number };
type Log = { id: number; ts: string; recordId: string; action: string; detail: string | null; recordName: string | null };

const OPS: Array<[Cond["op"], string]> = [["eq", "is"], ["ne", "is not"], ["contains", "contains"], ["empty", "is empty"], ["notempty", "is not empty"]];

export default function CaseAutomationPage() {
  const [assign, setAssign] = useState<Assign | null>(null);
  const [sla, setSla] = useState<Sla | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [fields, setFields] = useState<SField[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [a, m] = await Promise.all([api("/api/automation"), api<Meta>("/api/objects/case")]);
    if (!a.ok) return setErr(a.message);
    setAssign(a.data.assignment); setSla(a.data.sla); setStaff(a.data.staff); setLog(a.data.log);
    if (m.ok) setFields(m.data.fields);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    const r = await api("/api/automation", "PUT", { assignment: assign, sla });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setMsg("Saved. New cases use these rules immediately.");
  }
  async function sweep() {
    const r = await api("/api/automation/run", "POST");
    if (!r.ok) return setErr(r.message);
    setMsg(`Sweep checked ${r.data.checked} open cases: ${r.data.warned} warned, ${r.data.escalated} escalated.`);
    load();
  }

  if (!assign || !sla) return <div className="p-6 text-sm text-gray-400">{err || "Loading…"}</div>;
  const condFields = fields.filter((f) => ["picklist", "text", "lookup", "multipicklist"].includes(f.type) && !["subject", "description", "resolution"].includes(f.api));
  const setRule = (i: number, p: Partial<Rule>) => setAssign({ ...assign, rules: assign.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const moveRule = (i: number, by: number) => { const r = [...assign.rules]; const j = i + by; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; setAssign({ ...assign, rules: r }); };
  const statusOpts = fields.find((f) => f.api === "status")?.options ?? [];
  const setPol = (i: number, p: Partial<Policy>) => setSla({ ...sla, policies: sla.policies.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const numCls = `${inputCls} !w-24`;

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Link href="/o/case" className="text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700">Cases</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Case Automation</h1>
          <p className="mt-1 text-sm text-gray-500">Who gets a new case, and what happens when it runs late.</p>
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={sweep}><Play className="size-4" /> Run SLA check now</button>
          <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </Card>
      {msg && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Assignment rules</h2>
            <p className="text-sm text-gray-500">Checked top to bottom when a case is created; the first match wins. A case with an owner chosen by hand is never reassigned.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-lime" checked={assign.enabled} onChange={(e) => setAssign({ ...assign, enabled: e.target.checked })} /> Enabled</label>
        </div>

        <div className="mt-4 space-y-3">
          {assign.rules.map((r, i) => (
            <div key={r.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-gray-100 text-xs font-bold">{i + 1}</span>
                <input className={`${inputCls} !w-64`} aria-label="Rule name" placeholder="Rule name" value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} />
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-lime" checked={r.enabled} onChange={(e) => setRule(i, { enabled: e.target.checked })} /> On</label>
                <span className="ml-auto flex gap-1">
                  <button aria-label="Move up" onClick={() => moveRule(i, -1)} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"><ArrowUp className="size-4" /></button>
                  <button aria-label="Move down" onClick={() => moveRule(i, 1)} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"><ArrowDown className="size-4" /></button>
                  <button aria-label="Delete rule" onClick={() => setAssign({ ...assign, rules: assign.rules.filter((_, j) => j !== i) })} className="grid size-8 place-items-center rounded-lg text-red-400 hover:bg-red-50"><Trash2 className="size-4" /></button>
                </span>
              </div>

              <p className="mb-1 mt-3 text-xs font-semibold text-gray-500">When all of these match</p>
              <div className="space-y-2">
                {r.conditions.map((c, k) => {
                  const def = fields.find((f) => f.api === c.field);
                  const setC = (p: Partial<Cond>) => setRule(i, { conditions: r.conditions.map((x, m) => (m === k ? { ...x, ...p } : x)) });
                  return (
                    <div key={k} className="flex flex-wrap items-center gap-2">
                      <select className={`${inputCls} !w-44`} aria-label="Field" value={c.field} onChange={(e) => setC({ field: e.target.value, value: "" })}>{condFields.map((f) => <option key={f.api} value={f.api}>{f.label}</option>)}</select>
                      <select className={`${inputCls} !w-36`} aria-label="Operator" value={c.op} onChange={(e) => setC({ op: e.target.value as Cond["op"] })}>{OPS.map(([k2, l]) => <option key={k2} value={k2}>{l}</option>)}</select>
                      {!["empty", "notempty"].includes(c.op) && (def?.type === "picklist"
                        ? <select className={`${inputCls} !w-48`} aria-label="Value" value={c.value ?? ""} onChange={(e) => setC({ value: e.target.value })}><option value="">—</option>{def.options.map((o) => <option key={o}>{o}</option>)}</select>
                        : <input className={`${inputCls} !w-48`} aria-label="Value" value={c.value ?? ""} onChange={(e) => setC({ value: e.target.value })} />)}
                      <button aria-label="Remove condition" onClick={() => setRule(i, { conditions: r.conditions.filter((_, m) => m !== k) })} className="text-gray-300 hover:text-red-500"><Trash2 className="size-4" /></button>
                    </div>
                  );
                })}
                {r.conditions.length === 0 && <p className="text-xs text-gray-400">No conditions — this rule matches every case.</p>}
                <button className="text-xs font-semibold text-forest-800 hover:underline" onClick={() => setRule(i, { conditions: [...r.conditions, { field: condFields.find((f) => f.api === "type")?.api ?? condFields[0]?.api ?? "", op: "eq", value: "" }] })}>+ Add condition</button>
              </div>

              <p className="mb-1 mt-4 text-xs font-semibold text-gray-500">Assign to</p>
              <div className="flex flex-wrap items-start gap-3">
                <select className={`${inputCls} !w-64`} aria-label="Assign mode" value={r.mode} onChange={(e) => setRule(i, { mode: e.target.value as Rule["mode"] })}>
                  <option value="staff">A specific team member</option>
                  <option value="pool">Least-loaded in a group</option>
                  <option value="auto">Least-loaded, whole team</option>
                </select>
                {r.mode === "staff" && (
                  <select className={`${inputCls} !w-56`} aria-label="Team member" value={r.staffId ?? ""} onChange={(e) => setRule(i, { staffId: e.target.value })}>
                    <option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {r.mode === "pool" && (
                  <div className="flex flex-wrap gap-1.5">
                    {staff.map((s) => {
                      const on = (r.staffIds ?? []).includes(s.id);
                      return <button key={s.id} type="button" onClick={() => setRule(i, { staffIds: on ? r.staffIds!.filter((x) => x !== s.id) : [...(r.staffIds ?? []), s.id] })}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${on ? "bg-forest-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{s.name}</button>;
                    })}
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Only active, available team members are considered; load = their open cases.</p>
            </div>
          ))}
          <button className={btnGhost} onClick={() => setAssign({ ...assign, rules: [...assign.rules, { id: `r_${Math.random().toString(36).slice(2, 8)}`, name: "", enabled: true, conditions: [], mode: "auto" }] })}><Plus className="size-4" /> Add rule</button>
        </div>

        <label className="mt-5 block max-w-md">
          <span className="mb-1 block text-xs font-semibold text-gray-600">If no rule matches</span>
          <select className={inputCls} value={assign.fallback} onChange={(e) => setAssign({ ...assign, fallback: e.target.value as Assign["fallback"] })}>
            <option value="auto">Give it to the least-loaded available team member</option>
            <option value="creator">Keep it with whoever created it</option>
          </select>
        </label>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">SLA &amp; escalation</h2>
            <p className="text-sm text-gray-500">Sets a due date from the priority when none is entered, warns before it, and escalates when it is missed. Checked every 10 minutes.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 accent-lime" checked={sla.enabled} onChange={(e) => setSla({ ...sla, enabled: e.target.checked })} /> Enabled</label>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100">
              <th className="py-2 pr-4">Priority</th><th className="py-2 pr-4">Due within (days)</th><th className="py-2 pr-4">Warn before due (days)</th><th className="py-2">Escalate after overdue (days)</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {sla.policies.map((p, i) => (
                <tr key={p.priority}>
                  <td className="py-2 pr-4 font-semibold">{p.priority}</td>
                  <td className="py-2 pr-4"><input type="number" min={0} className={numCls} aria-label={`${p.priority} due days`} value={p.dueInDays} onChange={(e) => setPol(i, { dueInDays: Number(e.target.value) })} /></td>
                  <td className="py-2 pr-4"><input type="number" min={0} className={numCls} aria-label={`${p.priority} warn days`} value={p.warnDaysBefore} onChange={(e) => setPol(i, { warnDaysBefore: Number(e.target.value) })} /></td>
                  <td className="py-2"><input type="number" min={0} className={numCls} aria-label={`${p.priority} escalate days`} value={p.escalateAfterDays} onChange={(e) => setPol(i, { escalateAfterDays: Number(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Calendar days, not business days. Escalating sets Status to Escalated, raises the priority one level, and posts an alert on the case.</p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-600">Reassign escalated cases to (optional)</span>
            <select className={inputCls} value={sla.escalateTo} onChange={(e) => setSla({ ...sla, escalateTo: e.target.value })}>
              <option value="">Keep current owner</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-gray-600">Pause the clock while status is</legend>
            <div className="flex flex-wrap gap-1.5">
              {statusOpts.filter((s) => s !== "Closed").map((s) => {
                const on = sla.pauseStatuses.includes(s);
                return <button key={s} type="button" onClick={() => setSla({ ...sla, pauseStatuses: on ? sla.pauseStatuses.filter((x) => x !== s) : [...sla.pauseStatuses, s] })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${on ? "bg-forest-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{s}</button>;
              })}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Recent automation activity</h2>
        <ul className="mt-3 divide-y divide-gray-50 text-sm">
          {log.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><span className="mr-2 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs">{l.action}</span>
                {l.recordName ? <Link href={`/o/case/${l.recordId}`} className="font-semibold text-forest-800 hover:underline">{l.recordName}</Link> : l.recordId}
                {l.detail && <span className="text-gray-500"> — {l.detail}</span>}</span>
              <span className="text-xs text-gray-400">{fmtDateTime(l.ts)}</span>
            </li>
          ))}
          {log.length === 0 && <li className="py-6 text-center text-gray-400">Nothing yet. Warnings and escalations appear here.</li>}
        </ul>
        <p className="mt-3 text-[11px] text-gray-400">Assignments and due-date defaults are recorded in the main <Link href="/compliance/audit" className="underline">Audit Log</Link>.</p>
      </Card>
    </div>
  );
}
