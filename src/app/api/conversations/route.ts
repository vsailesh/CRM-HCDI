import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

// GET /api/conversations?channel=whatsapp|manual&stage=new&q=
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const channel = sp.get("channel");
  const stage = sp.get("stage");
  const q = sp.get("q");

  let where = " WHERE 1=1";
  const params: unknown[] = [];
  if (channel && channel !== "all") { where += " AND v.channel = ?"; params.push(channel); }
  if (stage && stage !== "all") { where += " AND c.leadStage = ?"; params.push(stage); }
  if (q) { where += " AND c.name LIKE ?"; params.push(`%${q}%`); }

  const rows = db.prepare(
    `SELECT v.id, v.channel, v.lastMessageAt, v.lastSnippet, v.unseen,
            c.id AS customerId, c.name, c.phone, c.status AS customerStatus, c.leadStage,
            s.name AS staffName
     FROM conversations v
     JOIN customers c ON c.id = v.customerId
     LEFT JOIN staff s ON s.id = c.assignedStaffId${where}
     ORDER BY v.lastMessageAt DESC`
  ).all(...params);

  const channels = db.prepare("SELECT channel, COUNT(*) AS n FROM conversations GROUP BY channel").all() as Array<{ channel: string; n: number }>;
  auditPhi(req, "list", "conversations", undefined, `rows=${(rows as unknown[]).length}${q ? " searched" : ""}`);
  return ok({ data: rows, channels });
}
