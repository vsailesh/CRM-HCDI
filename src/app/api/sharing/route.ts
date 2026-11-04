import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf } from "@/lib/api";
import { clientIp, logAudit } from "@/lib/audit";
import { LEVELS, levelOf, type Level } from "@/lib/access";
import { getObject, listObjects } from "@/lib/meta";

// GET — admin: sharing level per object
export async function GET(req: NextRequest) {
  if (actorOf(req)?.role !== "admin") return bad("Admin access required", 403);
  return ok(listObjects().map((o) => ({ api: o.api, label: o.plural, phi: o.phi, level: levelOf(o.api) })));
}

// PUT { levels: { [object]: "public" | "readonly" | "private" } }
export async function PUT(req: NextRequest) {
  const a = actorOf(req);
  if (a?.role !== "admin") return bad("Admin access required", 403);
  const b = await req.json().catch(() => ({}));
  const levels = (b.levels ?? {}) as Record<string, Level>;
  const changes: string[] = [];
  for (const [obj, level] of Object.entries(levels)) {
    if (!getObject(obj) || !LEVELS.includes(level)) return bad(`Invalid setting for ${obj}`);
    if (levelOf(obj) !== level) changes.push(`${obj}:${level}`);
    db.prepare("INSERT INTO sharing_settings (object,level) VALUES (?,?) ON CONFLICT(object) DO UPDATE SET level = excluded.level").run(obj, level);
  }
  logAudit({ actorId: a.sub, actorName: a.name, action: "access.settings.update", resource: "sharing", ip: clientIp(req), detail: changes.join(", ") || "no changes" });
  return ok({}, "Saved");
}
