import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

// POST /api/notes — {customerId, body}: pin a note to a customer timeline
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.customerId || !b?.body?.trim()) return bad("customerId and body required");
  const id = `note_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO notes (id, customerId, body, createdAt) VALUES (?,?,?,?)")
    .run(id, b.customerId, b.body.trim(), now);
  db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?, 'note', ?, ?)")
    .run(`act_${Date.now().toString(36)}_n`, b.customerId, b.body.trim().slice(0, 120), now);
  auditPhi(req, "create", "notes", id, `customer=${b.customerId}`);
  return ok({ id });
}
