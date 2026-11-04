"use client";

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
