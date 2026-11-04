"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import {
  FieldValue, RecordForm, api, btnDanger, btnGhost, btnPrimary, fmtDateTime, inputCls,
  type Meta, type RecordRow, type SField,
} from "@/components/records";

type Related = { object: string; label: string; via: string; viaApi: string; total: number; listFields: string[]; rows: RecordRow[] };
type Detail = { record: RecordRow; related: Related[]; feed: RecordRow[] };
type Staff = { id: string; name: string };

export default function RecordDetailPage() {
  const { obj, id } = useParams<{ obj: string; id: string }>();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [relMeta, setRelMeta] = useState<Record<string, SField[]>>({});
  const [staff, setStaff] = useState<Staff[]>([]);
  const [edit, setEdit] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [ownerId, setOwnerId] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState("");

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([api<Meta>(`/api/objects/${obj}`), api<Detail>(`/api/records/${obj}/${id}`)]);
    if (!m.ok || !r.ok) return setErr(m.message || r.message);
    setMeta(m.data); setD(r.data);
    setValues(r.data.record.values); setRefs(r.data.record.refs); setOwnerId(r.data.record.ownerId ?? "");
    const rm: Record<string, SField[]> = {};
    await Promise.all(r.data.related.map(async (x) => { const t = await api<Meta>(`/api/objects/${x.object}`); if (t.ok) rm[x.object] = t.data.fields; }));
    setRelMeta(rm);
  }, [obj, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<Staff[]>("/api/staff").then((r) => r.ok && setStaff(Array.isArray(r.data) ? r.data : (r.data as any)?.data ?? [])); }, []);

  async function save(patch?: Record<string, unknown>) {
    setBusy(true); setErr("");
    const r = await api(`/api/records/${obj}/${id}`, "PATCH", patch ? { values: patch } : { values, ownerId: ownerId || null });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setEdit(false); load();
  }
  async function remove() {
    if (!confirm(`Delete this ${meta?.object.label.toLowerCase()}? This cannot be undone.`)) return;
    const r = await api(`/api/records/${obj}/${id}`, "DELETE");
    if (!r.ok) return setErr(r.message);
    router.push(`/o/${obj}`);
  }
  async function sendPost() {
    if (!post.trim()) return;
    const r = await api(`/api/records/chatter`, "POST", { values: { body: post.trim(), relatedObject: obj, relatedRecordId: id } });
    if (r.ok) { setPost(""); load(); } else setErr(r.message);
  }

  if (!meta || !d) return <div className="p-6 text-sm text-gray-400">{err || "Loading…"}</div>;
  const rec = d.record;
  const pathField = meta.object.pathField ? meta.fields.find((f) => f.api === meta.object.pathField) : undefined;
  const closedLast = pathField?.options[pathField.options.length - 1];
  const stageIdx = pathField ? pathField.options.indexOf(String(rec.values[pathField.api] ?? "")) : -1;

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href={`/o/${obj}`} className="text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700">{meta.object.plural}</Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{rec.name}</h1>
            <p className="mt-1 text-xs text-gray-500">Owner: {rec.ownerName ?? "Unassigned"} · Updated {fmtDateTime(rec.updatedAt)}</p>
          </div>
          <div className="flex gap-2">
            {edit ? (
              <>
                <button className={btnGhost} onClick={() => { setEdit(false); setValues(rec.values); setRefs(rec.refs); setErr(""); }}>Cancel</button>
                <button className={btnPrimary} disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button>
              </>
            ) : (
              <>
                <button className={btnGhost} onClick={() => setEdit(true)}><Pencil className="size-4" /> Edit</button>
                <button className={btnDanger} onClick={remove}><Trash2 className="size-4" /> Delete</button>
              </>
            )}
          </div>
        </div>

        {pathField && (
          <ol className="mt-5 flex flex-wrap gap-1.5" aria-label={`${pathField.label} path`}>
            {pathField.options.map((o, i) => {
              const cur = i === stageIdx;
              return (
                <li key={o}>
                  <button disabled={busy || cur} onClick={() => save({ [pathField.api]: o })} aria-current={cur ? "step" : undefined}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      cur ? "bg-forest-800 text-white" : i < stageIdx ? "bg-lime-soft text-forest-800 hover:bg-lime/60" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                    {i < stageIdx && <Check className="size-3" />}{o}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {pathField && closedLast && <p className="mt-2 text-[11px] text-gray-400">Click a stage to move this {meta.object.label.toLowerCase()}.</p>}
        {err && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-gray-500">Details</h2>
            {edit ? (
              <>
                <RecordForm fields={meta.fields} values={values} refs={refs}
                  onChange={(a, v, name) => { setValues((p) => ({ ...p, [a]: v })); if (name !== undefined) setRefs((p) => ({ ...p, [a]: name })); }} />
                <label className="mt-4 block max-w-sm">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Owner</span>
                  <select className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {meta.fields.map((f) => (
                  <div key={f.api} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                    <dt className="text-xs font-semibold text-gray-500">{f.label}</dt>
                    <dd className="mt-0.5 text-sm"><FieldValue f={f} rec={rec} /></dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {d.related.map((rl) => {
            const rf = relMeta[rl.object] ?? [];
            const cols = rl.listFields.slice(0, 4).map((a) => rf.find((f) => f.api === a)).filter((f): f is SField => !!f && f.api !== rl.viaApi);
            return (
              <Card key={`${rl.object}-${rl.viaApi}`} className="p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">{rl.label} <span className="font-normal normal-case text-gray-400">({rl.total}) · via {rl.via}</span></h2>
                  <Link href={`/o/${rl.object}/new?${rl.viaApi}=${id}`} className="flex items-center gap-1 text-xs font-semibold text-forest-800 hover:underline"><Plus className="size-3" /> New</Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <tbody className="divide-y divide-gray-50">
                      {rl.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 pr-4"><Link href={`/o/${rl.object}/${r.id}`} className="font-semibold text-forest-800 hover:underline">{r.name}</Link></td>
                          {cols.slice(1).map((c) => <td key={c.api} className="py-2 pr-4 text-gray-600"><FieldValue f={c} rec={r} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rl.total > rl.rows.length && <Link href={`/o/${rl.object}`} className="mt-2 inline-block text-xs text-gray-500 hover:underline">View all in {rl.label}</Link>}
              </Card>
            );
          })}
        </div>

        <Card className="h-fit p-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Chatter</h2>
          <div className="flex gap-2">
            <textarea rows={2} className={`${inputCls} h-auto py-2`} placeholder="Share an update… (don't paste PHI)" value={post} onChange={(e) => setPost(e.target.value)} />
            <button aria-label="Post" onClick={sendPost} className="grid size-10 shrink-0 place-items-center self-end rounded-xl bg-lime text-forest-950 hover:bg-lime-hover"><Send className="size-4" /></button>
          </div>
          <ul className="mt-4 space-y-3">
            {d.feed.map((p) => (
              <li key={p.id} className="rounded-xl bg-gray-50 p-3">
                <p className="whitespace-pre-wrap text-sm">{String(p.values.body)}</p>
                <p className="mt-1 text-[11px] text-gray-400">{p.ownerName ?? (p.values.postType === "Alert" ? "Automation" : "Someone")} · {fmtDateTime(p.createdAt)}</p>
              </li>
            ))}
            {d.feed.length === 0 && <li className="py-4 text-center text-xs text-gray-400">No posts yet</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
