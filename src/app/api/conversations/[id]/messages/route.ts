import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

// POST /api/conversations/[id]/messages — agent reply
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { body } = await req.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string" || !body.trim()) return bad("message body required");

  const conv = db.prepare("SELECT id, customerId FROM conversations WHERE id = ?").get(id) as
    | { id: string; customerId: string }
    | undefined;
  if (!conv) return bad("conversation not found", 404);

  const now = new Date().toISOString();
  const mid = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare("INSERT INTO messages (id, conversationId, fromCustomer, body, sentAt) VALUES (?,?,0,?,?)").run(mid, id, body.trim(), now);
  db.prepare("UPDATE conversations SET lastMessageAt = ?, lastSnippet = ? WHERE id = ?").run(now, body.trim().slice(0, 80), id);
  db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(
    `act_${Date.now().toString(36)}`, conv.customerId, "message", `Replied in conversation: ${body.trim().slice(0, 60)}`, now
  );

  auditPhi(req, "create", "messages", mid, `conversation=${id}`);
  return ok({ id: mid, conversationId: id, fromCustomer: 0, body: body.trim(), sentAt: now });
}
