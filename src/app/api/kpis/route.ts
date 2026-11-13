import { NextRequest } from "next/server";
import { ok, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { computeKpis } from "@/lib/kpis";

// GET ?days=30&account=<health plan id> — counts and rates only, limited to records the caller may open
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const k = computeKpis({ days: Number(sp.get("days") ?? 30), account: sp.get("account") || undefined, viewer: viewerOf(req) });
  auditPhi(req, "list", "kpi", undefined, "kpi view");
  return ok(k);
}
