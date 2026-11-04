import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

type P = { params: Promise<{ id: string }> };

// GET /api/conversations/[id] — full thread + customer context
export async function GET(req: NextRequest, { params }: P) {
  const { id } = await params;
  const conv = db.prepare(
    `SELECT v.id, v.channel, v.lastMessageAt, v.lastSnippet, v.unseen,
            c.id AS customerId, c.name, c.phone, c.status AS customerStatus, c.leadStage,
            s.name AS staffName
     FROM conversations v
     JOIN customers c ON c.id = v.customerId
     LEFT JOIN staff s ON s.id = c.assignedStaffId
     WHERE v.id = ?`
  ).get(id);
  if (!conv) return bad("conversation not found", 404);

  const messages = db.prepare(
    "SELECT id, fromCustomer, body, sentAt FROM messages WHERE conversationId = ? ORDER BY sentAt ASC"
  ).all(id);

  // opening the thread marks it read
  db.prepare("UPDATE conversations SET unseen = 0 WHERE id = ? AND unseen > 0").run(id);

  auditPhi(req, "read", "conversations", id, `messages=${(messages as unknown[]).length}`);
  return ok({ conversation: { ...conv, unseen: 0 }, messages });
}

// PATCH /api/conversations/[id] — mark seen / unseen
export async function PATCH(req: NextRequest, { params }: P) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const unseen = body?.unseen ? 1 : 0;
  db.prepare("UPDATE conversations SET unseen = ? WHERE id = ?").run(unseen, id);
  return ok({ id, unseen });
}
