"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, X } from "lucide-react";
import type { SField, SObject } from "@/lib/meta";
import type { RecordRow, Filter } from "@/lib/records";

export type { SField, SObject, RecordRow, Filter };
export type Meta = { object: SObject; fields: SField[] };

export const inputCls = "h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-forest-800 focus:ring-2 focus:ring-lime/40";
export const CHART = ["#1e3a28", "#6f9c2e", "#2f6f9f", "#d9822b", "#7c5cbf", "#c2455f", "#2a9d8f", "#8a8f98"];

export async function api<T = any>(url: string, method = "GET", body?: unknown): Promise<{ ok: boolean; data: T; message: string }> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, data: j.data, message: j.message ?? "" };
}

export const fmtDate = (s?: unknown) => (s ? new Date(String(s).length === 10 ? `${s}T00:00:00` : String(s)).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");
export const fmtDateTime = (s?: unknown) => (s ? new Date(String(s)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** Read-only rendering of a field value. */
export function FieldValue({ f, rec }: { f: SField; rec: RecordRow }) {
  if (rec.hidden?.includes(f.api)) return <span className="inline-flex items-center gap-1 text-xs text-gray-400" title="Restricted by field security"><Lock className="size-3" /> Restricted</span>;
  const v = rec.values[f.api];
  if (v === undefined || v === null || v === "") return <span className="text-gray-300">—</span>;
  switch (f.type) {
    case "checkbox": return <span>{v ? "Yes" : "No"}</span>;
    case "lookup": return rec.refs[f.api] === "(restricted)" ? <span className="text-xs text-gray-400" title="You don't have access to this record">🔒 Restricted</span> : <Link href={`/o/${f.ref}/${v}`} className="font-medium text-forest-800 underline-offset-2 hover:underline">{rec.refs[f.api]}</Link>;
    case "date": return <>{fmtDate(v)}</>;
    case "datetime": return <>{fmtDateTime(v)}</>;
    case "percent": return <>{String(v)}%</>;
    case "currency": return <>{Number(v).toLocaleString(undefined, { style: "currency", currency: "USD" })}</>;
    case "number": return <>{Number(v).toLocaleString()}</>;
    case "multipicklist": return <span className="flex flex-wrap gap-1">{(v as string[]).map((x) => <Chip key={x}>{x}</Chip>)}</span>;
    case "picklist": return <Chip tone={tone(f.api, String(v))}>{String(v)}</Chip>;
    case "url": return <a href={String(v)} target="_blank" rel="noreferrer noopener" className="text-forest-800 underline-offset-2 hover:underline">{String(v)}</a>;
    case "email": return <a href={`mailto:${v}`} className="text-forest-800 hover:underline">{String(v)}</a>;
    case "phone": return <a href={`tel:${v}`} className="text-forest-800 hover:underline">{String(v)}</a>;
    case "textarea": return <span className="whitespace-pre-wrap">{String(v)}</span>;
    default: return <>{String(v)}</>;
  }
}

const GOOD = new Set(["Closed", "Active", "Published", "Approved", "Renewed", "Reached - Completed", "In-Network", "Submitted"]);
const WARN = new Set(["High", "Escalated", "Due Soon", "Waiting on Member", "Waiting on Provider", "Pending", "In Review", "Documents Requested"]);
const BAD = new Set(["Urgent", "Lapsed", "Denied", "Terminated", "Refused", "Wrong Number", "Out-of-Network"]);
function tone(api: string, v: string) {
  if (!["status", "priority", "renewalStatus", "outcome", "networkStatus"].includes(api)) return "gray";
  return BAD.has(v) ? "red" : WARN.has(v) ? "amber" : GOOD.has(v) ? "green" : "gray";
}
export function Chip({ children, tone = "gray" }: { children: ReactNode; tone?: string }) {
  const c = { gray: "bg-gray-100 text-gray-700", green: "bg-green-50 text-green-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700" }[tone] ?? "bg-gray-100 text-gray-700";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
}

/** Type-ahead picker that stores a record id. */
export function LookupPicker({ object, value, label, onChange }: { object: string; value: string; label?: string; onChange: (id: string, name: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await api(`/api/records/${object}?q=${encodeURIComponent(q)}&limit=8&sort=name&dir=asc`);
      setRows(r.data?.data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, object]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      {value && !open ? (
        <div className="flex h-10 items-center justify-between rounded-xl border border-gray-200 bg-white px-3 text-sm">
          <span className="truncate font-medium">{label ?? value}</span>
          <button type="button" aria-label="Clear" onClick={() => onChange("", "")} className="text-gray-400 hover:text-gray-700"><X className="size-4" /></button>
        </div>
      ) : (
        <input className={inputCls} placeholder={`Search ${object.replace(/_/g, " ")}…`} value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      )}
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
          {rows.length === 0 && <li className="px-3 py-2 text-xs text-gray-400">No matches</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { onChange(r.id, r.name); setOpen(false); setQ(""); }} className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50">{r.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Editable form generated from field metadata. */
export function RecordForm({ fields, values, refs, onChange }: {
  fields: SField[]; values: Record<string, unknown>; refs: Record<string, string>;
  onChange: (api: string, value: unknown, refName?: string) => void;
}) {
  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.api];
        const wide = f.type === "textarea";
        return (
          <label key={f.api} className={`block ${wide ? "sm:col-span-2" : ""}`}>
            <span className="mb-1 block text-xs font-semibold text-gray-600">{f.label}{f.required && <span className="text-red-500"> *</span>}</span>
            {f.type === "autonumber" ? (
              <div className="flex h-10 items-center rounded-xl bg-gray-50 px-3 text-sm text-gray-400">{v ? String(v) : "Assigned on save"}</div>
            ) : f.type === "textarea" ? (
              <textarea rows={3} className={`${inputCls} h-auto py-2`} value={String(v ?? "")} onChange={(e) => onChange(f.api, e.target.value)} />
            ) : f.type === "checkbox" ? (
              <input type="checkbox" className="size-5 accent-lime" checked={!!v} onChange={(e) => onChange(f.api, e.target.checked)} />
            ) : f.type === "picklist" ? (
              <select className={inputCls} value={String(v ?? "")} onChange={(e) => onChange(f.api, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.type === "multipicklist" ? (
              <div className="flex flex-wrap gap-1.5 rounded-xl border border-gray-200 p-2">
                {f.options.map((o) => {
                  const on = ((v as string[]) ?? []).includes(o);
                  return <button type="button" key={o} onClick={() => onChange(f.api, on ? (v as string[]).filter((x) => x !== o) : [...((v as string[]) ?? []), o])}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${on ? "bg-forest-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{o}</button>;
                })}
              </div>
            ) : f.type === "lookup" ? (
              <LookupPicker object={f.ref!} value={String(v ?? "")} label={refs[f.api]} onChange={(id, name) => onChange(f.api, id, name)} />
            ) : (
              <input className={inputCls}
                type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : ["number", "currency", "percent"].includes(f.type) ? "number" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                step={f.type === "number" ? "any" : f.type === "currency" || f.type === "percent" ? "0.01" : undefined}
                value={String(v ?? "")} onChange={(e) => onChange(f.api, e.target.value)} />
            )}
            {f.help && <span className="mt-1 block text-[11px] text-gray-400">{f.help}</span>}
          </label>
        );
      })}
    </div>
  );
}

export const OPS: Array<[string, string]> = [
  ["eq", "equals"], ["ne", "not equal"], ["contains", "contains"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"],
  ["empty", "is empty"], ["notempty", "is not empty"], ["lastDays", "in last N days"], ["nextDays", "in next N days"], ["overdue", "is in the past"],
];
const SYSTEM_FIELDS = [{ api: "name", label: "Record Name" }, { api: "ownerId", label: "Owner" }, { api: "createdAt", label: "Created" }, { api: "updatedAt", label: "Last Modified" }];

/** Rows of field / operator / value. */
export function FilterEditor({ fields, filters, onChange }: { fields: SField[]; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const opts = [...SYSTEM_FIELDS, ...fields.filter((f) => f.type !== "multipicklist").map((f) => ({ api: f.api, label: f.label }))];
  const set = (i: number, patch: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {filters.map((flt, i) => {
        const def = fields.find((x) => x.api === flt.field);
        const noValue = ["empty", "notempty", "overdue"].includes(flt.op);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={`${inputCls} !w-44`} value={flt.field} onChange={(e) => set(i, { field: e.target.value, value: "" })}>
              {opts.map((o) => <option key={o.api} value={o.api}>{o.label}</option>)}
            </select>
            <select className={`${inputCls} !w-36`} value={flt.op} onChange={(e) => set(i, { op: e.target.value })}>
              {OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {!noValue && (def?.type === "picklist" && ["eq", "ne"].includes(flt.op) ? (
              <select className={`${inputCls} !w-44`} value={flt.value ?? ""} onChange={(e) => set(i, { value: e.target.value })}>
                <option value="">—</option>{def.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : def?.type === "checkbox" ? (
              <select className={`${inputCls} !w-28`} value={flt.value ?? "true"} onChange={(e) => set(i, { value: e.target.value })}><option value="true">Yes</option><option value="false">No</option></select>
            ) : (
              <input className={`${inputCls} !w-44`} value={flt.value ?? ""} onChange={(e) => set(i, { value: e.target.value })} placeholder={def?.type === "lookup" ? "record id" : "value"} />
            ))}
            <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"><X className="size-4" /></button>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...filters, { field: opts[0].api, op: "eq", value: "" }])} className="text-xs font-semibold text-forest-800 hover:underline">+ Add filter</button>
    </div>
  );
}

/** Group-by choices for a given object's fields. */
export function groupOptions(fields: SField[]): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [{ value: "ownerId", label: "Owner" }];
  for (const f of fields) {
    if (["picklist", "lookup", "checkbox"].includes(f.type)) out.push({ value: f.api, label: f.label });
    if (f.type === "date" || f.type === "datetime") out.push({ value: `${f.api}:month`, label: `${f.label} (by month)` });
  }
  out.push({ value: "createdAt:month", label: "Created (by month)" });
  return out;
}
export const numericFields = (fields: SField[]) => fields.filter((f) => ["number", "currency", "percent"].includes(f.type));

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className={`max-h-[90vh] w-full overflow-auto rounded-2xl bg-white p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-gray-400 hover:bg-gray-100"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const btnPrimary = "flex h-10 items-center gap-2 rounded-xl bg-lime px-5 text-sm font-semibold text-forest-950 hover:bg-lime-hover active:scale-[0.98] disabled:opacity-50";
export const btnGhost = "flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium hover:bg-gray-50 disabled:opacity-50";
export const btnDanger = "flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50";
