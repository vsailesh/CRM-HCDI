"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { Card } from "@/components/ui";
import { api, btnDanger, fmtDateTime } from "@/components/records";

type Batch = {
  id: string; kind: string; object: string; label: string | null; createdByName: string | null; createdAt: string;
  status: "applied" | "rolled_back"; summary: Record<string, unknown>; rolledBackAt: string | null;
};

const summarize = (b: Batch) => {
  const s = b.summary;
  if (b.kind === "import") return `${s.created ?? 0} created · ${s.updated ?? 0} updated · ${s.unchanged ?? 0} unchanged · ${s.failed ?? 0} failed`;
  return `${s.updated ?? 0} updated of ${s.matched ?? 0} matched · ${s.failed ?? 0} failed`;
};

export default function BatchesPage() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<Batch[]>("/api/data/batches").then((r) => (r.ok ? setRows(r.data) : setErr(r.message))); }, []);
  useEffect(load, [load]);

  async function rollback(b: Batch) {
    if (!confirm("Undo this batch? Records it created are deleted and fields it changed are restored — fields anyone has edited since are left as they are.")) return;
    setErr(""); setMsg("");
    const r = await api(`/api/data/batches/${b.id}`, "POST");
    if (!r.ok) return setErr(r.message);
    const d = r.data;
    setMsg(`Rolled back: ${d.deleted} deleted, ${d.restored} restored${d.skippedConflict ? `, ${d.skippedConflict} field(s) left alone because they changed since` : ""}${d.blocked ? `, ${d.blocked} could not be deleted (still referenced)` : ""}.`);
    load();
  }

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Batches &amp; rollback</h1>
        <p className="mt-1 text-sm text-gray-500">Every import and bulk update is recorded here with what it did. Admins can undo a batch.</p>
      </Card>
      {msg && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
      <Card className="p-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-100"><th className="px-3 py-2.5">When</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Object</th><th className="px-3 py-2.5">Result</th><th className="px-3 py-2.5">By</th><th className="px-3 py-2.5">Status</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap px-3 py-2.5">{fmtDateTime(b.createdAt)}</td>
                <td className="px-3 py-2.5 capitalize">{b.kind}{b.label ? <span className="block max-w-48 truncate text-xs text-gray-400" title={b.label}>{b.label}</span> : null}</td>
                <td className="px-3 py-2.5">{b.object.replace(/_/g, " ")}</td>
                <td className="px-3 py-2.5 text-gray-600">{summarize(b)}</td>
                <td className="px-3 py-2.5 text-gray-500">{b.createdByName ?? "—"}</td>
                <td className="px-3 py-2.5">{b.status === "rolled_back" ? <span className="text-gray-400">Rolled back {fmtDateTime(b.rolledBackAt)}</span> : "Applied"}</td>
                <td className="px-3 py-2.5 text-right">{b.status === "applied" && <button className={`${btnDanger} !h-8 !px-3`} onClick={() => rollback(b)}><Undo2 className="size-3.5" /> Roll back</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-12 text-center text-gray-400">No imports or bulk updates yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
