"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

type Row = {
  seq: number; ts: string; actorName: string | null; action: string; resource: string | null;
  resourceId: string | null; outcome: string; ip: string | null; detail: string | null;
};

const FILTERS = [
  { label: "All", action: "" },
  { label: "PHI access", action: "phi" },
  { label: "Sign-ins", action: "auth" },
  { label: "Staff changes", action: "staff" },
  { label: "MFA", action: "mfa" },
];
const PAGE = 50;

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState("");
  const [chain, setChain] = useState<{ intact: boolean; brokenAtSeq: number | null } | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async (verify = false) => {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (action) q.set("action", action);
    if (outcome) q.set("outcome", outcome);
    if (verify) q.set("verify", "1");
    const res = await fetch(`/api/audit?${q}`);
    const json = await res.json();
    if (!res.ok) { setError(json.message ?? "Failed to load"); return; }
    setError("");
    setRows(json.data.data);
    setTotal(json.data.meta.total);
    if (json.data.chain) setChain(json.data.chain);
  }, [offset, action, outcome]);

  useEffect(() => { load(); }, [load]);

  async function verify() {
    setChecking(true);
    await load(true);
    setChecking(false);
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-500">Who accessed or changed what. Append-only and hash-chained; values are never logged, only record IDs.</p>
        </div>
        <button onClick={verify} disabled={checking}
          className="h-10 rounded-xl bg-lime px-4 text-sm font-semibold text-forest-950 hover:bg-lime-hover disabled:opacity-50">
          {checking ? "Verifying…" : "Verify integrity"}
        </button>
      </div>

      {chain && (
        <p className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${chain.intact ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {chain.intact ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
          {chain.intact ? "Chain intact — no entries have been altered or removed." : `Tampering detected: chain breaks at entry #${chain.brokenAtSeq}.`}
        </p>
      )}
      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.label} onClick={() => { setAction(f.action); setOffset(0); }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${action === f.action ? "bg-forest-950 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {f.label}
          </button>
        ))}
        <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setOffset(0); }}
          className="ml-auto h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs">
          <option value="">Any outcome</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>{["#", "Time", "User", "Action", "Resource", "Outcome", "IP", "Detail"].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => (
              <tr key={r.seq} className="align-top">
                <td className="px-3 py-2 text-gray-400">{r.seq}</td>
                <td className="whitespace-nowrap px-3 py-2">{new Date(r.ts).toLocaleString()}</td>
                <td className="px-3 py-2">{r.actorName ?? <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.resource ?? "—"}{r.resourceId ? ` / ${r.resourceId}` : ""}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.outcome === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{r.outcome}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.ip ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.detail ?? ""}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No entries</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total}</span>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Newer</button>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Older</button>
        </div>
      </div>
    </div>
  );
}
