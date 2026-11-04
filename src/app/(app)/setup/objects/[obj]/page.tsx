"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { Modal, api, btnGhost, btnPrimary, inputCls, type Meta } from "@/components/records";
import { FIELD_TYPES, type FieldType } from "@/lib/meta-types";

type Obj = { api: string; label: string; plural: string }; // for lookup targets

const blank = { label: "", type: "text" as FieldType, required: false, options: "", ref: "", prefix: "", digits: 4, help: "" };

export default function ObjectDetailSetupPage() {
  const { obj } = useParams<{ obj: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(() => api<Meta>(`/api/objects/${obj}`).then((r) => r.ok && setMeta(r.data)), [obj]);
  useEffect(() => { load(); api<Obj[]>("/api/objects").then((r) => r.ok && setObjects(r.data)); }, [load]);

  async function add() {
    const body = { ...f, options: f.options.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean) };
    const r = await api(`/api/objects/${obj}`, "POST", body);
    if (!r.ok) return setErr(r.message);
    setOpen(false); setF(blank); setErr(""); setMsg(`Field “${body.label}” added`); load();
  }
  async function del(apiName: string) {
    if (!confirm(`Delete field ${apiName}? Existing values stay in the data but are no longer shown.`)) return;
    const r = await api(`/api/objects/${obj}?field=${apiName}`, "DELETE");
    if (!r.ok) setErr(r.message); else { setMsg("Field deleted"); load(); }
  }
  async function toggleList(apiName: string) {
    if (!meta) return;
    const cur = meta.object.listFields;
    const next = cur.includes(apiName) ? cur.filter((x) => x !== apiName) : [...cur, apiName];
    const r = await api(`/api/objects/${obj}`, "PATCH", { listFields: next });
    if (r.ok) load(); else setErr(r.message);
  }

  if (!meta) return <div className="p-6 text-sm text-gray-400">{err || "Loading…"}</div>;
  const needsOptions = f.type === "picklist" || f.type === "multipicklist";

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <Link href="/setup/objects" className="text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700">Object Manager</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{meta.object.plural}</h1>
          <p className="mt-1 font-mono text-xs text-gray-400">{meta.object.api} · name: {meta.object.nameTemplate}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/o/${obj}`} className={btnGhost}>Open records</Link>
          <button className={btnPrimary} onClick={() => { setOpen(true); setErr(""); }}><Plus className="size-4" /> New Field</button>
        </div>
      </Card>
      {msg && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
      {err && !open && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}

      <Card className="overflow-x-auto p-2">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100">
            {["Field label", "API name", "Type", "Required", "Details", "In list", ""].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">
            {meta.fields.map((fl) => (
              <tr key={fl.api}>
                <td className="px-4 py-2.5 font-medium">{fl.label}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{fl.api}</td>
                <td className="px-4 py-2.5">{fl.type}</td>
                <td className="px-4 py-2.5">{fl.required ? "Yes" : ""}</td>
                <td className="max-w-xs truncate px-4 py-2.5 text-xs text-gray-500" title={fl.options.join(", ")}>
                  {fl.type === "lookup" ? `→ ${fl.ref}` : fl.options.length ? fl.options.join(", ") : fl.auto ? `${fl.auto.prefix}${"0".repeat(fl.auto.digits)}` : fl.def ? `default: ${fl.def}` : ""}
                </td>
                <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Show ${fl.label} in list`} className="size-4 accent-lime" checked={meta.object.listFields.includes(fl.api)} onChange={() => toggleList(fl.api)} /></td>
                <td className="px-4 py-2.5 text-right"><button aria-label={`Delete ${fl.label}`} onClick={() => del(fl.api)} className="text-gray-300 hover:text-red-500"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {open && (
        <Modal title="New Field" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Label</span>
              <input autoFocus className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Type</span>
              <select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FieldType })}>{FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            {needsOptions && <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Options (one per line)</span>
              <textarea rows={4} className={`${inputCls} h-auto py-2`} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} /></label>}
            {f.type === "lookup" && <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Points to</span>
              <select className={inputCls} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })}><option value="">Choose object…</option>{objects.map((o) => <option key={o.api} value={o.api}>{o.plural}</option>)}</select></label>}
            {f.type === "autonumber" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Prefix</span><input className={inputCls} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Digits</span><input type="number" min={1} max={10} className={inputCls} value={f.digits} onChange={(e) => setF({ ...f, digits: Number(e.target.value) })} /></label>
              </div>
            )}
            <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-600">Help text</span><input className={inputCls} value={f.help} onChange={(e) => setF({ ...f, help: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-lime" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required</label>
          </div>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <div className="mt-5 flex justify-end gap-2"><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
            <button className={btnPrimary} disabled={!f.label.trim()} onClick={add}>Add field</button></div>
        </Modal>
      )}
    </div>
  );
}
