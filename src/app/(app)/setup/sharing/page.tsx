"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { api, btnPrimary, inputCls } from "@/components/records";

type Row = { api: string; label: string; phi: boolean; level: "public" | "readonly" | "private" };

const LEVELS: Array<[Row["level"], string, string]> = [
  ["public", "Public read/write", "Everyone can view and edit"],
  ["readonly", "Public read-only", "Everyone can view; owner, shared users and admins edit"],
  ["private", "Private", "Owner, shared users and admins only"],
];

export default function SharingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { api<Row[]>("/api/sharing").then((r) => (r.ok ? setRows(r.data) : setErr(r.message))); }, []);

  async function save() {
    setMsg(""); setErr("");
    const r = await api("/api/sharing", "PUT", { levels: Object.fromEntries(rows.map((x) => [x.api, x.level])) });
    if (r.ok) setMsg("Saved. Applies immediately to everyone."); else setErr(r.message);
  }

  return (
    <div className="space-y-5 p-6">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sharing &amp; Access</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Decide who can open each kind of record. Admins always see everything. On private objects, people also see records
            linked to something they own — for example the contact on a case assigned to them. Owners can share individual records
            from the record page. Hide sensitive fields per object under <Link href="/setup/objects" className="underline">Object Manager</Link>.
          </p>
        </div>
        <button className={btnPrimary} onClick={save}>Save changes</button>
      </Card>
      {msg && <p className="rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700">{msg}</p>}
      {err && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">{err}</p>}

      <Card className="overflow-x-auto p-2">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500"><tr className="border-b border-gray-100">
            <th className="px-4 py-3">Object</th><th className="px-4 py-3">PHI</th><th className="px-4 py-3">Default access</th><th className="px-4 py-3">What it means</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={r.api}>
                <td className="px-4 py-3 font-semibold">{r.label}</td>
                <td className="px-4 py-3">{r.phi ? "Yes" : "—"}</td>
                <td className="px-4 py-3">
                  <select aria-label={`Access for ${r.label}`} className={`${inputCls} !w-52`} value={r.level} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, level: e.target.value as Row["level"] } : x)))}>
                    {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{LEVELS.find(([k]) => k === r.level)?.[2]}
                  {r.phi && r.level === "public" && <span className="ml-2 font-semibold text-amber-700">PHI visible to all staff</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
