"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Modal, api, btnGhost, btnPrimary, inputCls, type SObject } from "@/components/records";

type Row = SObject & { count: number };

export default function ObjectManagerPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ label: "", plural: "", description: "", phi: false });
  const [err, setErr] = useState("");

  useEffect(() => { api<Row[]>("/api/objects").then((r) => r.ok && setRows(r.data)); }, []);
  async function create() {
    const r = await api("/api/objects", "POST", f);
    if (!r.ok) return setErr(r.message);
    router.push(`/setup/objects/${r.data.api}`);
  }

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Object Manager</h1>
          <p className="mt-1 text-sm text-gray-500">Define objects and the fields on them. Admin only for changes.</p>
        </div>
        <button className={btnPrimary} onClick={() => { setOpen(true); setErr(""); }}><Plus className="size-4" /> New Custom Object</button>
      </Card>
      <Card className="overflow-x-auto p-2">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100">
            {["Label", "API name", "Type", "PHI", "Records"].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((o) => (
              <tr key={o.api} className="hover:bg-gray-50">
                <td className="px-4 py-3"><Link href={`/setup/objects/${o.api}`} className="font-semibold text-forest-800 hover:underline">{o.plural}</Link></td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.api}</td>
                <td className="px-4 py-3">{o.isSystem ? "Standard" : "Custom"}</td>
                <td className="px-4 py-3">{o.phi ? "Yes" : "—"}</td>
                <td className="px-4 py-3 tabular-nums">{o.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && (
        <Modal title="New Custom Object" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Label (singular)</span>
              <input autoFocus className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Plural label</span>
              <input className={inputCls} placeholder={f.label ? `${f.label}s` : ""} value={f.plural} onChange={(e) => setF({ ...f, plural: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Description</span>
              <input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-lime" checked={f.phi} onChange={(e) => setF({ ...f, phi: e.target.checked })} /> Will hold PHI (turns on access logging)</label>
          </div>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <div className="mt-5 flex justify-end gap-2"><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} disabled={!f.label.trim()} onClick={create}>Create</button></div>
        </Modal>
      )}
    </div>
  );
}
