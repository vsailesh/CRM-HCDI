"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { api, fmtDateTime } from "@/components/records";

type H = { id: number; fieldLabel: string; oldValue: unknown; newValue: unknown; changedAt: string; changedByName: string | null; source: string };
const show = (v: unknown) => (v == null || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
const SRC: Record<string, string> = { import: "import", bulk: "bulk update", rollback: "rollback", automation: "automation" };

/** Field change history for one record (who, when, from where). Respects record access and field security on the server. */
export function HistoryPanel({ obj, id, version }: { obj: string; id: string; version?: unknown }) {
  const [rows, setRows] = useState<H[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api<H[]>(`/api/records/${obj}/${id}/history`).then((r) => setRows(r.ok ? r.data : [])); }, [obj, id, version]);
  if (!rows) return null;
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Card className="h-fit p-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Field history</h2>
      {rows.length === 0 ? <p className="py-2 text-xs text-gray-400">No changes recorded yet</p> : (
        <ul className="space-y-3">
          {shown.map((h) => (
            <li key={h.id} className="text-sm">
              <p><b>{h.fieldLabel}</b>: <span className="text-gray-400 line-through">{show(h.oldValue)}</span> → <span>{show(h.newValue)}</span></p>
              <p className="text-xs text-gray-400">{fmtDateTime(h.changedAt)} · {h.changedByName ?? "System"}{SRC[h.source] ? ` · ${SRC[h.source]}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 8 && <button className="mt-3 text-xs font-medium text-forest-800 hover:underline" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
    </Card>
  );
}
