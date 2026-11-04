"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Download, Plus, Search } from "lucide-react";
import { Card } from "@/components/ui";
import { FieldValue, csvCell, api, btnGhost, btnPrimary, inputCls, type Filter, type Meta, type RecordRow } from "@/components/records";

const PAGE = 25;

export default function ObjectListPage() {
  const { obj } = useParams<{ obj: string }>();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("updatedAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [mine, setMine] = useState(false);
  const [pick, setPick] = useState({ field: "", value: "" });
  const [error, setError] = useState("");
  const [level, setLevel] = useState("public");

  useEffect(() => {
    setMeta(null); setOffset(0); setQ(""); setPick({ field: "", value: "" }); setError("");
    api<Meta>(`/api/objects/${obj}`).then((r) => (r.ok ? setMeta(r.data) : setError(r.message)));
  }, [obj]);

  const quick = meta?.fields.find((f) => f.type === "picklist" && ["status", "stage"].includes(f.api)) ?? meta?.fields.find((f) => f.type === "picklist");

  const load = useCallback(async () => {
    if (!meta) return;
    const filters: Filter[] = pick.field && pick.value ? [{ field: pick.field, op: "eq", value: pick.value }] : [];
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, dir });
    if (q) p.set("q", q);
    if (mine) p.set("owner", "me");
    if (filters.length) p.set("filters", JSON.stringify(filters));
    const r = await api(`/api/records/${obj}?${p}`);
    if (r.ok) { setRows(r.data.data); setTotal(r.data.meta.total); setLevel(r.data.meta.level ?? "public"); } else setError(r.message);
  }, [meta, obj, offset, q, sort, dir, mine, pick]);

  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  async function exportCsv() {
    if (!meta) return;
    const filters: Filter[] = pick.field && pick.value ? [{ field: pick.field, op: "eq", value: pick.value }] : [];
    const r = await api(`/api/reports/run`, "POST", { object: obj, filters, csv: true, sort, dir });
    if (!r.ok) return;
    const cols = meta.fields.filter((f) => f.type !== "textarea");
    const esc = csvCell;
    const csv = [["Record Name", ...cols.map((c) => c.label)].map(esc).join(","),
      ...(r.data.rows as RecordRow[]).map((rec) => [rec.name, ...cols.map((c) => (c.type === "lookup" ? rec.refs[c.api] : Array.isArray(rec.values[c.api]) ? (rec.values[c.api] as string[]).join("; ") : rec.values[c.api]))].map(esc).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${obj}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  if (error && !meta) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!meta) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  const cols = meta.object.listFields.map((a) => meta.fields.find((f) => f.api === a)).filter((f): f is NonNullable<typeof f> => !!f);
  const toggle = (api: string) => { if (sort === api) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(api); setDir("asc"); } setOffset(0); };

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{meta.object.plural}</h1>
          <p className="mt-1 text-sm text-gray-500">{meta.object.description}</p>
          {meta.object.phi && <p className="mt-2 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Contains PHI — all access is logged</p>}
          {level === "private" && <p className="ml-2 mt-2 inline-block rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Private — you see records you own, were shared with you, or that relate to your work</p>}
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={exportCsv}><Download className="size-4" /> Export</button>
          <Link href={`/o/${obj}/new`} className={btnPrimary}><Plus className="size-4" /> New {meta.object.label}</Link>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-gray-400" />
            <input className={`${inputCls} pl-9`} placeholder={`Search ${meta.object.plural.toLowerCase()}…`} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
          </div>
          {quick && (
            <select className={`${inputCls} !w-52`} aria-label={`Filter by ${quick.label}`} value={pick.field === quick.api ? pick.value : ""} onChange={(e) => { setPick({ field: quick.api, value: e.target.value }); setOffset(0); }}>
              <option value="">All {quick.label.toLowerCase()}</option>
              {quick.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" className="size-4 accent-lime" checked={mine} onChange={(e) => { setMine(e.target.checked); setOffset(0); }} /> My records</label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-100">
                {cols.map((c) => (
                  <th key={c.api} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    <button onClick={() => toggle(c.api)} className="inline-flex items-center gap-1 uppercase hover:text-gray-900">
                      {c.label}{sort === c.api && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-semibold">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/o/${obj}/${r.id}`)} className="cursor-pointer hover:bg-gray-50">
                  {cols.map((c, i) => (
                    <td key={c.api} className="px-3 py-2.5 align-top" onClick={c.type === "lookup" ? (e) => e.stopPropagation() : undefined}>
                      {i === 0 && c.type !== "lookup" ? <Link href={`/o/${obj}/${r.id}`} className="font-semibold text-forest-800 hover:underline"><FieldValue f={c} rec={r} /></Link> : <FieldValue f={c} rec={r} />}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-gray-500">{r.ownerName ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="px-3 py-12 text-center text-gray-400">No {meta.object.plural.toLowerCase()} found</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </Card>
    </div>
  );
}
