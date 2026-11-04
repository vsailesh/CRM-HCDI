import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { getObject, listObjects, newId } from "@/lib/meta";
import { isApi } from "@/lib/records";

// GET /api/objects — all objects with record counts (drives navigation + Object Manager)
export async function GET() {
  const counts = new Map((db.prepare("SELECT object, COUNT(*) n FROM srecords GROUP BY object").all() as { object: string; n: number }[]).map((r) => [r.object, r.n]));
  return ok(listObjects().map((o) => ({ ...o, count: counts.get(o.api) ?? 0 })));
}

// POST /api/objects — admin creates a custom object { label, plural?, api?, description?, phi? }
export async function POST(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const b = await req.json().catch(() => ({}));
  const label = String(b.label ?? "").trim();
  if (!label) return bad("Label is required");
  const plural = String(b.plural ?? "").trim() || `${label}s`;
  const api = String(b.api ?? "").trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!isApi(api)) return bad("API name must start with a letter and use letters, numbers, underscore");
  if (getObject(api)) return bad("An object with that API name already exists", 409);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO sobjects (api,label,plural,icon,description,nameTemplate,pathField,phi,isSystem,listFields,sortOrder,createdAt)
      VALUES (?,?,?,?,?,?,NULL,?,0,?,1000,?)`).run(api, label, plural, "box", b.description ?? null, "{name}", b.phi ? 1 : 0, JSON.stringify(["name"]), now);
    db.prepare(`INSERT INTO sfields (id,object,api,label,type,required,options,sortOrder) VALUES (?,?,?,?,?,1,'[]',0)`)
      .run(newId("fld"), api, "name", `${label} Name`, "text");
  })();
  logAudit({ actorId: a.sub, actorName: a.name, action: "schema.object.create", resource: "sobject", resourceId: api, ip: clientIp(req) });
  return ok({ api }, "Created");
}
