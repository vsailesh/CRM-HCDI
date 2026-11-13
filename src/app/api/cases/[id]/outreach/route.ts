import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad, actorOf, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { canEdit, canRead } from "@/lib/access";
import { logOutreach } from "@/lib/myday";

type Ctx = { params: Promise<{ id: string }> };

// POST { channel, outcome, nextStep?, followUpDate?, notes?, languageUsed?, interpreterUsed? }
// Logs one outreach attempt on a case you can edit; updates the case's attempts / last outreach / engagement status.
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = actorOf(req);
  if (!a) return bad("Sign in required", 401);
  const { id } = await ctx.params;
  const row = db.prepare("SELECT id, ownerId FROM srecords WHERE id = ? AND object = 'case'").get(id) as { id: string; ownerId: string | null } | undefined;
  const viewer = viewerOf(req);
  if (!row || !canRead("case", row, viewer)) return bad("Case not found or you don't have access", 404);
  if (!canEdit("case", row, viewer)) return bad("You have read-only access to this case", 403);
  const b = await req.json().catch(() => ({}));
  const r = logOutreach(id, b, a.sub);
  if (r.errors.length) return bad(r.errors.join("; "), 422);
  auditPhi(req, "create", "engagement_log", r.id, `outreach on case ${id}`);
  return ok({ id: r.id, engagementStatus: r.engagementStatus }, "Outreach logged");
}
