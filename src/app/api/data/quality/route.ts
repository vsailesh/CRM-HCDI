import { NextRequest } from "next/server";
import { ok, bad, actorOf, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getObject } from "@/lib/meta";
import { normalizeField, scoreObject } from "@/lib/data-quality";

// GET ?object=contact → scorecard (counts + record ids only)
export async function GET(req: NextRequest) {
  const object = req.nextUrl.searchParams.get("object") ?? "";
  const o = getObject(object);
  if (!o) return bad("Choose an object", 404);
  const q = scoreObject(object, viewerOf(req));
  if (o.phi) auditPhi(req, "list", object, undefined, `quality scan rows=${q.total}`);
  return ok(q);
}

// POST { object, field } — repair every value in that field the normalisers can fix (admin)
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const b = await req.json().catch(() => ({}));
  if (!getObject(b.object)) return bad("Object not found", 404);
  try {
    const r = normalizeField(b.object, String(b.field), a.sub);
    auditPhi(req, "update", b.object, undefined, `normalize field=${b.field} records=${r.records}`);
    return ok(r, `Fixed ${r.records} record${r.records === 1 ? "" : "s"}`);
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}
