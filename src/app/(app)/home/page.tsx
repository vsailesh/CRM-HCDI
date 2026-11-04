"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { Chip, FieldValue, api, fmtDate, fmtDateTime, type Filter, type RecordRow, type SField } from "@/components/records";

type List = { data: RecordRow[]; meta: { total: number } };
const q = (object: string, filters: Filter[], extra = "") =>
  api<List>(`/api/records/${object}?limit=6&filters=${encodeURIComponent(JSON.stringify(filters))}${extra}`).then((r) => (r.ok ? r.data : { data: [], meta: { total: 0 } }));

const NOT_CLOSED: Filter = { field: "status", op: "ne", value: "Closed" };

export default function HomePage() {
  const [me, setMe] = useState("");
  const [mine, setMine] = useState<List | null>(null);
  const [open, setOpen] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [calls, setCalls] = useState<List | null>(null);
  const [renewals, setRenewals] = useState(0);
  const [feed, setFeed] = useState<RecordRow[]>([]);
  const [dashes, setDashes] = useState<Array<{ id: string; name: string }>>([]);
  const [caseFields, setCaseFields] = useState<SField[]>([]);

  useEffect(() => {
    api("/api/auth/me").then((r) => r.ok && setMe(String(r.data.name ?? "").split(" ")[0]));
    q("case", [NOT_CLOSED], "&owner=me&sort=dueDate&dir=asc").then(setMine);
    q("case", [NOT_CLOSED]).then((r) => setOpen(r.meta.total));
    q("case", [NOT_CLOSED, { field: "dueDate", op: "overdue" }]).then((r) => setOverdue(r.meta.total));
    q("redetermination_call", [{ field: "followUpDate", op: "nextDays", value: "7" }], "&sort=followUpDate&dir=asc").then(setCalls);
    q("household", [{ field: "renewalStatus", op: "eq", value: "Due Soon" }]).then((r) => setRenewals(r.meta.total));
    api<List>("/api/records/chatter?limit=5&sort=createdAt").then((r) => r.ok && setFeed(r.data.data));
    api<Array<{ id: string; name: string }>>("/api/dashboards").then((r) => r.ok && setDashes(r.data));
    api<{ fields: SField[] }>("/api/objects/case").then((r) => r.ok && setCaseFields(r.data.fields));
  }, []);

  const f = (a: string) => caseFields.find((x) => x.api === a);
  const tiles = [
    { label: "Open cases", value: open, href: "/o/case" },
    { label: "Overdue cases", value: overdue, href: "/o/case", warn: overdue > 0 },
    { label: "Households due for renewal", value: renewals, href: "/o/household" },
    { label: "Follow-up calls this week", value: calls?.meta.total ?? 0, href: "/o/redetermination_call" },
  ];

  return (
    <div className="space-y-5 p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back{me ? `, ${me}` : ""}</h1>
        <p className="mt-1 text-sm text-gray-500">Your work queue across cases, outreach and renewals.</p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="rounded-3xl border border-gray-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover">
            <p className={`text-4xl font-bold tracking-tight ${t.warn ? "text-red-600" : ""}`}>{t.value}</p>
            <p className="mt-1 text-sm text-gray-500">{t.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">My open cases</h2>
            <Link href="/o/case/new" className="text-xs font-semibold text-forest-800 hover:underline">+ New case</Link>
          </div>
          <ul className="divide-y divide-gray-50">
            {mine?.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link href={`/o/case/${c.id}`} className="block truncate text-sm font-semibold text-forest-800 hover:underline">{c.name}</Link>
                  <span className="text-xs text-gray-400">{String(c.values.caseNumber ?? "")}{c.values.dueDate ? ` · due ${fmtDate(c.values.dueDate)}` : ""}</span>
                </div>
                <div className="flex gap-1.5">{f("priority") && <FieldValue f={f("priority")!} rec={c} />}{f("status") && <FieldValue f={f("status")!} rec={c} />}</div>
              </li>
            ))}
            {mine && mine.data.length === 0 && <li className="py-8 text-center text-sm text-gray-400">Nothing assigned to you. 🎉</li>}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Dashboards</h2>
          <ul className="space-y-1">
            {dashes.slice(0, 6).map((d) => <li key={d.id}><Link href={`/dashboards/${d.id}`} className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50">{d.name}</Link></li>)}
            {dashes.length === 0 && <li className="text-sm text-gray-400">None yet</li>}
          </ul>
          <Link href="/dashboards" className="mt-2 inline-block text-xs font-semibold text-forest-800 hover:underline">All dashboards →</Link>
        </Card>

        <Card className="p-6 xl:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Follow-up calls — next 7 days</h2>
          <ul className="divide-y divide-gray-50">
            {calls?.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/o/redetermination_call/${c.id}`} className="truncate font-semibold text-forest-800 hover:underline">{c.name}</Link>
                <span className="shrink-0 text-xs text-gray-500">{c.refs.household ?? ""} · {fmtDate(c.values.followUpDate)}</span>
              </li>
            ))}
            {calls && calls.data.length === 0 && <li className="py-6 text-center text-sm text-gray-400">No follow-ups scheduled</li>}
          </ul>
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Chatter</h2>
          <ul className="space-y-3">
            {feed.map((p) => (
              <li key={p.id} className="text-sm">
                <p className="line-clamp-3">{String(p.values.body)}</p>
                <p className="mt-0.5 text-[11px] text-gray-400">{p.ownerName ?? "Someone"} · {fmtDateTime(p.createdAt)} {p.values.postType === "Announcement" && <Chip tone="amber">Announcement</Chip>}</p>
              </li>
            ))}
            {feed.length === 0 && <li className="text-sm text-gray-400">No posts yet</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
