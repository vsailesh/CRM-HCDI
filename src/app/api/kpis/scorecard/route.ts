import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf, viewerOf } from "@/lib/api";
import { computeKpis } from "@/lib/kpis";

// GET ?days=30 — "my numbers vs the team average". The team figures are totals divided by the number of people carrying
// cases (counts only; nothing about anyone else's records). Rates and averages are the team-wide figure.
export async function GET(req: NextRequest) {
  if (!actorOf(req)) return bad("Sign in required", 401);
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const mine = computeKpis({ days, viewer: viewerOf(req) });
  const team = computeKpis({ days });
  const people = Math.max(1, (db.prepare("SELECT COUNT(DISTINCT ownerId) n FROM srecords WHERE object = 'case' AND ownerId IS NOT NULL AND COALESCE(json_extract(data,'$.status'),'') != 'Closed'").get() as { n: number }).n);
  const rows = mine.tiles.map((t) => {
    const tt = team.tiles.find((x) => x.key === t.key)!;
    const teamAvg = tt.value == null ? null : t.unit === "count" ? Math.round((tt.value / people) * 10) / 10 : tt.value;
    return { key: t.key, label: t.label, unit: t.unit, good: t.good, mine: t.value, teamAvg, hint: t.hint };
  });
  return ok({ people, period: mine.period, rows });
}
