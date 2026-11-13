"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal, FilterEditor, api, btnGhost, btnPrimary, inputCls, type Filter, type SField } from "@/components/records";

type Res = { dryRun: boolean; batchId: string | null; matched: number; updated: number; unchanged: number; failed: number; errors: string[] };
type Person = { id: string; name: string };

/** Admin tool: apply one change to every record matching a filter. Preview first; applied runs are undoable batches. */
export function BulkModal({ object, label, fields, initialFilters, onClose, onDone }: {
  object: string; label: string; fields: SField[]; initialFilters: Filter[]; onClose: () => void; onDone: () => void;
}) {
  const editable = fields.filter((f) => !["autonumber", "lookup", "multipicklist"].includes(f.type));
  const [filters, setFilters] = useState<Filter[]>(initialFilters);
  const [field, setField] = useState(editable[0]?.api ?? "");
  const [value, setValue] = useState("");
  const [owner, setOwner] = useState("");
  const [staff, setStaff] = useState<Person[]>([]);
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Person[] | { data: Person[] }>("/api/staff").then((r) => r.ok && setStaff(Array.isArray(r.data) ? r.data : r.data?.data ?? []));
  }, []);

  const def = editable.find((f) => f.api === field);
  const change = (fn: () => void) => { fn(); setRes(null); };
  const setPart = () => (field && (value !== "" || def?.type === "checkbox") && value !== "" ? { [field]: def?.type === "checkbox" ? value === "true" : value } : {});

  async function run(dryRun: boolean) {
    setBusy(true); setErr("");
    const r = await api<Res>(`/api/records/${object}/bulk`, "POST", {
      filters: filters.filter((f) => f.field), set: setPart(), ownerId: owner === "" ? undefined : owner === "__none" ? null : owner, dryRun, label: `Bulk update ${label}`,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setRes(r.data);
    if (!dryRun) onDone();
  }

  return (
    <Modal title={`Bulk update ${label}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div><p className="mb-2 text-xs font-semibold uppercase text-gray-500">Records where</p><FilterEditor fields={fields} filters={filters} onChange={(f) => change(() => setFilters(f))} /></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs font-semibold uppercase text-gray-500">Set field</p>
            <div className="flex gap-2">
              <select className={inputCls} value={field} onChange={(e) => change(() => { setField(e.target.value); setValue(""); })}>{editable.map((f) => <option key={f.api} value={f.api}>{f.label}</option>)}</select>
              {def?.type === "picklist" ? (
                <select className={inputCls} value={value} onChange={(e) => change(() => setValue(e.target.value))}><option value="">(leave as is)</option>{def.options.map((o) => <option key={o}>{o}</option>)}</select>
              ) : def?.type === "checkbox" ? (
                <select className={inputCls} value={value} onChange={(e) => change(() => setValue(e.target.value))}><option value="">(leave as is)</option><option value="true">Yes</option><option value="false">No</option></select>
              ) : (
                <input className={inputCls} value={value} placeholder={def?.type === "date" ? "YYYY-MM-DD" : "new value"} onChange={(e) => change(() => setValue(e.target.value))} />
              )}
            </div>
          </div>
          <div><p className="mb-1 text-xs font-semibold uppercase text-gray-500">Reassign owner</p>
            <select className={inputCls} value={owner} onChange={(e) => change(() => setOwner(e.target.value))}><option value="">(leave as is)</option><option value="__none">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
        </div>
        {err && <p className="rounded-xl bg-red-50 px-4 py-2 font-medium text-red-600">{err}</p>}
        {res && (
          <p className={`rounded-xl px-4 py-3 ${res.dryRun ? "bg-gray-50" : "bg-green-50 text-green-800"}`}>
            {res.dryRun ? "Preview: " : "Done: "}<b>{res.matched}</b> matched · <b>{res.updated}</b> {res.dryRun ? "would change" : "changed"} · {res.unchanged} already correct · {res.failed} failed
            {res.errors.length > 0 && <span className="mt-1 block text-xs text-red-600">{res.errors.slice(0, 3).join(" | ")}</span>}
            {!res.dryRun && res.batchId && <> · <Link href="/data/history" className="underline">Undo from Batches</Link></>}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Close</button>
          <button className={btnGhost} disabled={busy} onClick={() => run(true)}>Preview</button>
          <button className={btnPrimary} disabled={busy || !res?.dryRun || res.updated === 0} onClick={() => run(false)}>Apply to {res?.updated ?? 0} records</button>
        </div>
      </div>
    </Modal>
  );
}
