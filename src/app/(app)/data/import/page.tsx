"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Play, Upload } from "lucide-react";
import { Card } from "@/components/ui";
import { api, btnGhost, btnPrimary, inputCls, type Meta, type SField, type SObject } from "@/components/records";
import { parseDelimited } from "@/lib/normalize";

type Result = {
  dryRun: boolean; batchId: string | null; rows: number; created: number; updated: number; unchanged: number; skippedProtected: number;
  skippedFilled: number; lookupsCreated: number; failed: number; fieldUpdates: Record<string, number>; cleaned: Record<string, number>;
  errors: { row: number; message: string }[]; errorsTruncated: boolean;
};
const MAX_ROWS = 5000;

export default function ImportPage() {
  const [objects, setObjects] = useState<SObject[]>([]);
  const [object, setObject] = useState("contact");
  const [fields, setFields] = useState<SField[]>([]);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [matchField, setMatchField] = useState("");
  const [mode, setMode] = useState("upsert");
  const [policy, setPolicy] = useState("protect_edits");
  const [autoLookups, setAutoLookups] = useState(false);
  const [lookupKeys, setLookupKeys] = useState<Record<string, string>>({});
  const [targetFields, setTargetFields] = useState<Record<string, SField[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api<SObject[]>("/api/objects").then((r) => r.ok && setObjects(r.data)); }, []);
  useEffect(() => {
    api<Meta>(`/api/objects/${object}`).then((r) => r.ok && setFields(r.data.fields.filter((f) => f.type !== "autonumber")));
    setResult(null); setMapping({}); setMatchField(""); setLookupKeys({});
  }, [object]);

  // auto-suggest a mapping whenever a file is loaded
  async function loadFile(file: File) {
    setErr(""); setResult(null);
    const text = await file.text();
    const grid = parseDelimited(text);
    if (grid.length < 2) return setErr("The file needs a header row and at least one data row.");
    if (grid.length - 1 > MAX_ROWS) return setErr(`That file has ${grid.length - 1} rows — the limit is ${MAX_ROWS} per import. Split it and import in parts.`);
    const hs = grid[0].map((h) => h.trim());
    setFileName(file.name); setHeaders(hs);
    setRows(grid.slice(1).map((r) => Object.fromEntries(hs.map((h, i) => [h, r[i] ?? ""]))));
    const r = await api(`/api/data/import?object=${object}&headers=${encodeURIComponent(hs.join("\u001f"))}`);
    if (r.ok) setMapping(r.data.suggested ?? {});
  }

  const mappedLookups = useMemo(() => fields.filter((f) => f.type === "lookup" && Object.values(mapping).includes(f.api)), [fields, mapping]);
  useEffect(() => {
    for (const f of mappedLookups) {
      if (f.ref && !targetFields[f.ref]) api<Meta>(`/api/objects/${f.ref}`).then((r) => r.ok && setTargetFields((p) => ({ ...p, [f.ref!]: r.data.fields })));
    }
  }, [mappedLookups, targetFields]);

  const mappedTargets = Object.values(mapping).filter(Boolean);
  const keyChoices = fields.filter((f) => mappedTargets.includes(f.api) && f.type !== "lookup");

  async function run(dryRun: boolean) {
    setBusy(true); setErr("");
    const r = await api<Result>("/api/data/import", "POST", {
      object, rows, mapping, matchField: matchField || undefined, mode, updatePolicy: policy, lookupKeys, autoCreateLookups: autoLookups,
      dryRun, label: fileName,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setResult(r.data);
  }

  const ready = rows.length > 0 && mappedTargets.length > 0;
  const fieldLabel = (api: string) => fields.find((f) => f.api === api)?.label ?? api;

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Import data</h1>
        <p className="mt-1 text-sm text-gray-500">
          Load a CSV into any object. Rows are matched on a key, values are cleaned (phone, ZIP, state, dates incl. date-of-birth century, language), and you
          see an exact preview before anything is written. Every import is a batch you can roll back.
        </p>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="font-semibold">1 · Choose object and file</h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Object</span>
            <select className={`${inputCls} !w-64`} value={object} onChange={(e) => { setObject(e.target.value); setRows([]); setHeaders([]); setFileName(""); }}>
              {objects.map((o) => <option key={o.api} value={o.api}>{o.plural}</option>)}
            </select>
          </label>
          <label className={`${btnGhost} cursor-pointer`}>
            <FileUp className="size-4" /> {fileName || "Choose CSV file"}
            <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          </label>
          {rows.length > 0 && <span className="text-sm text-gray-500">{rows.length.toLocaleString()} rows · {headers.length} columns</span>}
        </div>
        <p className="text-xs text-gray-400">Save Excel files as CSV first. Files stay in your browser until you run the preview.</p>
      </Card>

      {headers.length > 0 && (
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">2 · Map columns to fields</h2>
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {headers.map((h) => (
              <div key={h} className="grid grid-cols-[1fr_1fr] items-center gap-3">
                <span className="truncate text-sm font-medium" title={h}>{h}</span>
                <select className={inputCls} value={mapping[h] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Field for column ${h}`}>
                  <option value="">— skip this column —</option>
                  <option value="@owner">Owner (staff name or email)</option>
                  {fields.map((f) => <option key={f.api} value={f.api} disabled={mappedTargets.includes(f.api) && mapping[h] !== f.api}>{f.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {headers.length > 0 && (
        <Card className="space-y-4 p-6">
          <h2 className="font-semibold">3 · How to treat existing records</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Match existing records on</span>
              <select className={inputCls} value={matchField} onChange={(e) => setMatchField(e.target.value)}>
                <option value="">Nothing — always create new</option>
                {keyChoices.map((f) => <option key={f.api} value={f.api}>{f.label}</option>)}
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">Mode</span>
              <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="upsert">Create new and update existing</option>
                <option value="create_only">Create new only</option>
                <option value="update_only">Update existing only</option>
              </select>
            </label>
            <label className="text-sm"><span className="mb-1 block text-xs font-semibold uppercase text-gray-500">When a record already has a value</span>
              <select className={inputCls} value={policy} onChange={(e) => setPolicy(e.target.value)}>
                <option value="protect_edits">Overwrite, but keep values staff edited by hand</option>
                <option value="fill_blank">Only fill empty fields</option>
                <option value="overwrite">Overwrite with the file</option>
              </select>
            </label>
          </div>
          {mappedLookups.length > 0 && (
            <div className="space-y-2 rounded-xl bg-gray-50 p-4">
              <p className="text-sm font-semibold">Related records</p>
              {mappedLookups.map((f) => (
                <label key={f.api} className="grid items-center gap-3 text-sm md:grid-cols-[14rem_1fr]">
                  <span>{f.label} → find the {f.ref?.replace(/_/g, " ")} by</span>
                  <select className={inputCls} value={lookupKeys[f.api] ?? ""} onChange={(e) => setLookupKeys((k) => ({ ...k, [f.api]: e.target.value }))}>
                    <option value="">Record name</option>
                    {(targetFields[f.ref!] ?? []).filter((t) => !["lookup", "textarea", "autonumber", "checkbox"].includes(t.type)).map((t) => <option key={t.api} value={t.api}>{t.label}</option>)}
                  </select>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-lime" checked={autoLookups} onChange={(e) => setAutoLookups(e.target.checked)} />
                Create the related record when none matches (needs a field other than “Record name” above)</label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={btnGhost} disabled={!ready || busy} onClick={() => run(true)}><Play className="size-4" /> {busy ? "Working…" : "Preview (no changes)"}</button>
            <button className={btnPrimary} disabled={!ready || busy || !result?.dryRun || result.failed === result.rows} onClick={() => run(false)}><Upload className="size-4" /> Import {rows.length.toLocaleString()} rows</button>
          </div>
          {!result?.dryRun && !result && <p className="text-xs text-gray-400">Run the preview first — the import button unlocks after it.</p>}
        </Card>
      )}

      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}

      {result && (
        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-3">
            {result.dryRun ? <h2 className="font-semibold">Preview — nothing has been saved yet</h2>
              : <h2 className="flex items-center gap-2 font-semibold text-green-700"><CheckCircle2 className="size-5" /> Import complete</h2>}
            {!result.dryRun && result.batchId && <Link href="/data/history" className="text-sm font-medium text-forest-800 hover:underline">View batch / roll back →</Link>}
          </div>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Rows", result.rows], ["Create", result.created], ["Update", result.updated], ["Unchanged", result.unchanged],
              ["Kept (staff-edited)", result.skippedProtected], ["Kept (already filled)", result.skippedFilled], ["Related created", result.lookupsCreated], ["Failed", result.failed]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-gray-100 p-3"><dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt><dd className="mt-1 text-xl font-bold tabular-nums">{Number(v).toLocaleString()}</dd></div>
            ))}
          </dl>
          {Object.keys(result.cleaned).length > 0 && (
            <p className="text-sm text-gray-600"><b>Auto-cleaned:</b> {Object.entries(result.cleaned).map(([k, n]) => `${fieldLabel(k)} (${n})`).join(", ")}</p>
          )}
          {Object.keys(result.fieldUpdates).length > 0 && (
            <p className="text-sm text-gray-600"><b>Fields updated:</b> {Object.entries(result.fieldUpdates).map(([k, n]) => `${fieldLabel(k)} (${n})`).join(", ")}</p>
          )}
          {result.errors.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-red-600">{result.failed} row{result.failed === 1 ? "" : "s"} will be skipped</p>
              <div className="max-h-64 overflow-auto rounded-xl border border-gray-100">
                <table className="w-full text-left text-sm"><tbody className="divide-y divide-gray-50">
                  {result.errors.map((e, i) => <tr key={i}><td className="w-20 px-3 py-1.5 tabular-nums text-gray-500">Row {e.row}</td><td className="px-3 py-1.5">{e.message}</td></tr>)}
                </tbody></table>
              </div>
              {result.errorsTruncated && <p className="mt-1 text-xs text-gray-400">Only the first 200 problems are listed.</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
