"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui";
import { RecordForm, api, btnGhost, btnPrimary, type Meta } from "@/components/records";

function NewRecordForm() {
  const { obj } = useParams<{ obj: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Meta>(`/api/objects/${obj}`).then(async (r) => {
      if (!r.ok) return setErr(r.message);
      setMeta(r.data);
      const v: Record<string, unknown> = {};
      const rf: Record<string, string> = {};
      for (const f of r.data.fields) {
        if (f.def != null && f.type !== "autonumber") v[f.api] = f.type === "number" ? Number(f.def) : f.def;
        const pre = sp.get(f.api); // ?contact=<id> pre-fills lookups (used by related-list "New" buttons)
        if (pre && f.type === "lookup") {
          v[f.api] = pre;
          const t = await api(`/api/records/${f.ref}/${pre}`);
          if (t.ok) rf[f.api] = t.data.record.name;
        }
      }
      setValues(v); setRefs(rf);
    });
  }, [obj, sp]);

  async function save() {
    setBusy(true); setErr("");
    const r = await api(`/api/records/${obj}`, "POST", { values });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    router.push(`/o/${obj}/${r.data.id}`);
  }

  if (!meta) return <div className="p-6 text-sm text-gray-400">{err || "Loading…"}</div>;
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">New {meta.object.label}</h1>
        <div className="mt-6">
          <RecordForm fields={meta.fields} values={values} refs={refs}
            onChange={(a, v, name) => { setValues((p) => ({ ...p, [a]: v })); if (name !== undefined) setRefs((p) => ({ ...p, [a]: name })); }} />
        </div>
        {err && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Link href={`/o/${obj}`} className={btnGhost}>Cancel</Link>
          <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </Card>
    </div>
  );
}

export default function NewRecordPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}><NewRecordForm /></Suspense>;
}
