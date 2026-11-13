"use client";

import { useState } from "react";

import { CHART } from "@/components/records";

export type Group = { key: string; label: string; value: number; count: number };

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(n));

/** Horizontal bars with the value printed on each row (readable without hover). */
export function BarList({ groups, onPick }: { groups: Group[]; onPick?: (g: Group) => void }) {
  const max = Math.max(1, ...groups.map((g) => g.value));
  if (!groups.length) return <p className="py-6 text-center text-sm text-gray-400">No data</p>;
  return (
    <ul className="space-y-2">
      {groups.map((g) => (
        <li key={g.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-gray-600" title={g.label}>{g.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${g.label}: ${g.value}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (g.value / max) * 100)}%`, background: CHART[0] }} onClick={() => onPick?.(g)} />
          </div>
          <span className="w-12 text-right font-semibold tabular-nums">{fmt(g.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Donut + legend with values and share. */
export function Donut({ groups }: { groups: Group[] }) {
  const total = groups.reduce((s, g) => s + g.value, 0);
  if (!total) return <p className="py-6 text-center text-sm text-gray-400">No data</p>;
  let acc = 0;
  const stops = groups.map((g, i) => {
    const from = (acc / total) * 100; acc += g.value;
    return `${CHART[i % CHART.length]} ${from}% ${(acc / total) * 100}%`;
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative size-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops.join(",")})` }} role="img" aria-label="Distribution chart">
        <div className="absolute inset-[22%] grid place-items-center rounded-full bg-white text-center">
          <div><p className="text-xl font-bold leading-none">{fmt(total)}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">total</p></div>
        </div>
      </div>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {groups.map((g, i) => (
          <li key={g.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART[i % CHART.length] }} />
            <span className="flex-1 truncate text-gray-600" title={g.label}>{g.label}</span>
            <span className="font-semibold tabular-nums">{fmt(g.value)}</span>
            <span className="w-10 text-right text-xs text-gray-400">{Math.round((g.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── KPI components ───────────── */

export type RateRow = { key: string; label: string; total: number; done: number; rate: number; target?: number | null };
const BLUE = "#2f6f9f", GREEN = "#6f9c2e", GRAY = "#8a8f98";

/** Horizontal progress bars: share done per group, count printed, optional target tick. */
export function RateBars({ rows, doneLabel = "done", onPick }: { rows: RateRow[]; doneLabel?: string; onPick?: (r: RateRow) => void }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-gray-400">No data</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" title={`${r.label}: ${r.done} of ${r.total} ${doneLabel}${r.target != null ? ` · target ${r.target}%` : ""}`}>
          <span className="truncate text-gray-600">{r.label}</span>
          <div className="relative h-3 rounded-full bg-gray-100" role="img" aria-label={`${r.label}: ${r.rate}% ${doneLabel} (${r.done} of ${r.total})`} onClick={() => onPick?.(r)}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(r.rate > 0 ? 2 : 0, r.rate))}%`, background: BLUE }} />
            {r.target != null && <span className="absolute -top-1 h-5 w-0.5 rounded bg-gray-700" style={{ left: `${Math.min(100, r.target)}%` }} aria-hidden />}
          </div>
          <span className="w-28 text-right tabular-nums"><b>{r.rate}%</b> <span className="text-xs text-gray-400">{r.done}/{r.total}</span></span>
        </li>
      ))}
    </ul>
  );
}

export type TrendPoint = { key: string; a: number; b: number };

/** Two-series line chart (a = gray, b = blue) with a hover crosshair and a table-friendly legend. */
export function TrendChart({ points, aLabel, bLabel, unit }: { points: TrendPoint[]; aLabel: string; bLabel: string; unit: "week" | "month" }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, L = 34, R = 10, T = 12, B = 24;
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const nice = Math.max(1, Math.ceil(max / 4) * 4);
  const x = (i: number) => L + (points.length <= 1 ? (W - L - R) / 2 : (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / nice) * (H - T - B);
  const path = (k: "a" | "b") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const lbl = (k: string) => (unit === "month" ? new Date(`${k}-01T00:00:00`).toLocaleDateString(undefined, { month: "short" }) : new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  if (!points.length || max === 0 && points.every((p) => p.a === 0 && p.b === 0)) return <p className="py-10 text-center text-sm text-gray-400">No activity in this period</p>;
  const step = Math.ceil(points.length / 8);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: GRAY }} />{aLabel}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: BLUE }} />{bLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${aLabel} and ${bLabel} per ${unit}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))))); }}>
        {[0, 1, 2, 3, 4].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y((nice / 4) * g)} y2={y((nice / 4) * g)} stroke="#eceef0" /><text x={L - 6} y={y((nice / 4) * g) + 3} textAnchor="end" fontSize="10" fill="#6b7280">{(nice / 4) * g}</text></g>)}
        {points.map((p, i) => i % step === 0 && <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6b7280">{lbl(p.key)}</text>)}
        <path d={path("a")} fill="none" stroke={GRAY} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path("b")} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#9ca3af" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].a)} r="4" fill={GRAY} stroke="#fff" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(points[hover].b)} r="4" fill={BLUE} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      <p className="mt-1 min-h-5 text-xs text-gray-600" aria-live="polite">
        {hover != null ? <><b>{unit === "month" ? lbl(points[hover].key) : `Week of ${lbl(points[hover].key)}`}</b> · {aLabel}: <b>{points[hover].a}</b> · {bLabel}: <b>{points[hover].b}</b></> : "Hover the chart for exact values"}
      </p>
    </div>
  );
}

/** Headline number with change vs the previous period. */
export function KpiTile({ label, value, prev, unit, good, hint }: { label: string; value: number | null; prev: number | null; unit: "count" | "pct" | "days"; good: "up" | "down"; hint: string }) {
  const fmtV = (v: number | null) => (v == null ? "—" : unit === "pct" ? `${v}%` : unit === "days" ? `${v}d` : v.toLocaleString());
  const delta = value != null && prev != null ? Math.round((value - prev) * 10) / 10 : null;
  const better = delta == null || delta === 0 ? null : (delta > 0) === (good === "up");
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" title={hint}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums leading-none">{fmtV(value)}</p>
      <p className={`mt-2 h-4 text-xs font-medium ${better == null ? "text-gray-400" : better ? "text-green-700" : "text-red-600"}`}>
        {delta == null ? "\u00a0" : delta === 0 ? "No change vs previous" : `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)}${unit === "pct" ? " pts" : unit === "days" ? "d" : ""} vs previous${better ? " (better)" : " (worse)"}`}
      </p>
    </div>
  );
}
