import { NextRequest } from "next/server";
import { ok, bad, actorOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { getFields, getObject } from "@/lib/meta";
import { MAX_ROWS, runImport, suggestMapping, type ImportSpec } from "@/lib/importer";

// POST { object, rows:[{col:value}], mapping, matchField?, mode, updatePolicy, lookupKeys?, autoCreateLookups?, dryRun, label? }
// Admin only (minimum necessary: bulk-loading member data is a data-manager action). Counts only in responses and audit.
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required to import data", 403);
  const b = await req.json().catch(() => null);
  if (!b || typeof b.object !== "string" || !Array.isArray(b.rows) || typeof b.mapping !== "object" || !b.mapping) return bad("object, rows and mapping are required");
  const o = getObject(b.object);
  if (!o) return bad("Object not found", 404);
  if (b.rows.length > MAX_ROWS) return bad(`Too many rows — max ${MAX_ROWS} per import`);
  const spec: ImportSpec = {
    object: b.object, rows: b.rows, mapping: b.mapping, matchField: b.matchField || undefined,
    mode: ["upsert", "create_only", "update_only"].includes(b.mode) ? b.mode : "upsert",
    updatePolicy: ["overwrite", "fill_blank", "protect_edits"].includes(b.updatePolicy) ? b.updatePolicy : "protect_edits",
    lookupKeys: b.lookupKeys && typeof b.lookupKeys === "object" ? b.lookupKeys : undefined,
    autoCreateLookups: !!b.autoCreateLookups, dryRun: b.dryRun !== false, label: typeof b.label === "string" ? b.label.slice(0, 60) : undefined,
  };
  try {
    const r = runImport(spec, { id: a.sub, name: a.name });
    if (!r.dryRun) auditPhi(req, "import", b.object, r.batchId ?? undefined, `rows=${r.rows} created=${r.created} updated=${r.updated} failed=${r.failed}`);
    return ok(r);
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}

// GET ?object=case&headers=a,b,c → suggested column mapping + field list (for the import wizard)
export async function GET(req: NextRequest) {
  const object = req.nextUrl.searchParams.get("object") ?? "";
  if (!getObject(object)) return bad("Object not found", 404);
  const headers = (req.nextUrl.searchParams.get("headers") ?? "").split("\u001f").filter(Boolean);
  return ok({ fields: getFields(object).filter((f) => f.type !== "autonumber"), suggested: suggestMapping(object, headers) });
}
