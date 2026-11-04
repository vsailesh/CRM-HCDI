import { NextRequest } from "next/server";
import { ok, bad, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getObject } from "@/lib/meta";
import { aggregate, listRecords } from "@/lib/records";

// POST { object, filters, groupBy?, metric?, metricField?, columns?, limit?, csv? }
// Summary (groupBy set) → groups; otherwise a tabular list. csv:true returns text/csv.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const o = getObject(b.object);
  if (!o) return bad("Choose an object");
  const filters = Array.isArray(b.filters) ? b.filters : [];
  try {
    if (b.groupBy) {
      const r = aggregate({ object: b.object, filters, groupBy: b.groupBy, metric: b.metric, metricField: b.metricField, limit: 100, viewer: viewerOf(req) });
      if (o.phi) auditPhi(req, "list", b.object, undefined, "report summary");
      return ok({ mode: "summary", ...r });
    }
    const { rows, total } = listRecords(b.object, { filters, limit: Math.min(b.csv ? 5000 : 200, b.limit ?? 200), sort: b.sort, dir: b.dir, viewer: viewerOf(req) });
    if (o.phi) auditPhi(req, b.csv ? "export" : "list", b.object, undefined, `report rows=${rows.length}`);
    return ok({ mode: "list", rows, total });
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}
