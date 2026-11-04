import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { FIELD_TYPES, getFields, getObject, newId, type FieldType } from "@/lib/meta";
import { isApi } from "@/lib/records";

type Ctx = { params: Promise<{ obj: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { obj } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  return ok({ object: o, fields: getFields(obj) });
}

// PATCH — admin edits object settings { label, plural, description, phi, listFields, nameTemplate }
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const { obj } = await ctx.params;
  const o = getObject(obj);
  if (!o) return bad("Object not found", 404);
  const b = await req.json().catch(() => ({}));
  const apis = new Set(getFields(obj).map((f) => f.api));
  if (b.listFields && (!Array.isArray(b.listFields) || b.listFields.some((x: string) => !apis.has(x)))) return bad("listFields must be field API names");
  db.prepare("UPDATE sobjects SET label=?, plural=?, description=?, phi=?, listFields=?, nameTemplate=? WHERE api=?").run(
    String(b.label ?? o.label), String(b.plural ?? o.plural), b.description ?? o.description, (b.phi ?? o.phi) ? 1 : 0,
    JSON.stringify(b.listFields ?? o.listFields), String(b.nameTemplate ?? o.nameTemplate), obj);
  logAudit({ actorId: a.sub, actorName: a.name, action: "schema.object.update", resource: "sobject", resourceId: obj, ip: clientIp(req) });
  return ok({}, "Saved");
}

// POST — admin adds a field { api, label, type, required?, options?, ref?, help?, def? }
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const { obj } = await ctx.params;
  if (!getObject(obj)) return bad("Object not found", 404);
  const b = await req.json().catch(() => ({}));
  const label = String(b.label ?? "").trim();
  const type = b.type as FieldType;
  if (!label) return bad("Label is required");
  if (!FIELD_TYPES.includes(type)) return bad("Unknown field type");
  const api = String(b.api ?? "").trim() || label.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c: string) => c.toLowerCase());
  if (!isApi(api)) return bad("API name must start with a letter and use letters, numbers, underscore");
  if (getFields(obj).some((f) => f.api === api)) return bad("A field with that API name already exists", 409);
  const options = Array.isArray(b.options) ? b.options.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
  if ((type === "picklist" || type === "multipicklist") && options.length === 0) return bad("Add at least one option");
  if (type === "lookup" && !getObject(String(b.ref))) return bad("Choose the object this field points to");
  const auto = type === "autonumber" ? JSON.stringify({ prefix: String(b.prefix ?? ""), digits: Math.min(10, Math.max(1, Number(b.digits) || 4)) }) : null;
  const sortOrder = (db.prepare("SELECT COALESCE(MAX(sortOrder),0)+1 n FROM sfields WHERE object = ?").get(obj) as { n: number }).n;
  db.prepare(`INSERT INTO sfields (id,object,api,label,type,required,options,ref,help,auto,def,sortOrder) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(newId("fld"), obj, api, label, type, b.required ? 1 : 0, JSON.stringify(options), type === "lookup" ? b.ref : null, b.help ?? null, auto, b.def ?? null, sortOrder);
  logAudit({ actorId: a.sub, actorName: a.name, action: "schema.field.create", resource: "sobject", resourceId: `${obj}.${api}`, ip: clientIp(req) });
  return ok({ api }, "Created");
}

// PUT { field, visibleTo: "all" | "owner" | "admin" } — admin sets field-level security
export async function PUT(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const { obj } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (!["all", "owner", "admin"].includes(b.visibleTo)) return bad("visibleTo must be all, owner or admin");
  const hit = db.prepare("UPDATE sfields SET visibleTo = ? WHERE object = ? AND api = ?").run(b.visibleTo, obj, b.field);
  if (!hit.changes) return bad("Field not found", 404);
  logAudit({ actorId: a.sub, actorName: a.name, action: "access.field.update", resource: "sobject", resourceId: `${obj}.${b.field}`, ip: clientIp(req), detail: `visibleTo=${b.visibleTo}` });
  return ok({}, "Saved");
}

// DELETE ?field=api — admin removes a field (values on existing records are left in place)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const { obj } = await ctx.params;
  const o = getObject(obj);
  const api = req.nextUrl.searchParams.get("field") ?? "";
  if (!o || !getFields(obj).some((f) => f.api === api)) return bad("Field not found", 404);
  if (o.nameTemplate.includes(`{${api}`)) return bad("This field builds the record name; change the name template first");
  if (o.pathField === api) return bad("This field drives the status path and cannot be deleted");
  db.prepare("DELETE FROM sfields WHERE object = ? AND api = ?").run(obj, api);
  db.prepare("UPDATE sobjects SET listFields = ? WHERE api = ?").run(JSON.stringify(o.listFields.filter((x) => x !== api)), obj);
  logAudit({ actorId: a.sub, actorName: a.name, action: "schema.field.delete", resource: "sobject", resourceId: `${obj}.${api}`, ip: clientIp(req) });
  return ok({}, "Deleted");
}
