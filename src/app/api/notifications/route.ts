import db from "@/lib/db";
import { ok } from "@/lib/api";

// GET /api/notifications — derived feed, nothing stored
export async function GET() {
  const now = new Date().toISOString();

  const overdue = db.prepare(
    `SELECT COUNT(*) AS n FROM followups WHERE status = 'pending' AND dueAt < ?`
  ).get(now) as { n: number };

  const unseen = db.prepare(
    "SELECT COUNT(*) AS n FROM conversations WHERE unseen > 0"
  ).get() as { n: number };

  const unassigned = db.prepare(
    `SELECT COUNT(*) AS n FROM leads l
     JOIN customers c ON c.id = l.customerId
     WHERE c.status != 'archived' AND l.assignedStaffId IS NULL`
  ).get() as { n: number };

  const staleLeads = db.prepare(
    `SELECT COUNT(*) AS n FROM leads l
     JOIN customers c ON c.id = l.customerId
     WHERE c.status != 'archived' AND l.updatedAt < datetime('now', '-14 days')`
  ).get() as { n: number };

  const caseCount = (extra: string) => (db.prepare(`SELECT COUNT(*) AS n FROM srecords WHERE object = 'case' AND COALESCE(json_extract(data,'$.status'),'') != 'Closed' ${extra}`).get() as { n: number }).n;
  const escalated = caseCount("AND json_extract(data,'$.status') = 'Escalated'");
  const overdueCases = caseCount("AND json_extract(data,'$.dueDate') < date('now')");

  const feed: Array<{ id: string; kind: string; text: string; href: string; count: number }> = [];
  if (overdue.n > 0) feed.push({ id: "overdue", kind: "warning", text: overdue.n === 1 ? "follow-up overdue" : "follow-ups overdue", href: "/crm/follow-ups", count: overdue.n });
  if (unseen.n > 0) feed.push({ id: "unseen", kind: "info", text: unseen.n === 1 ? "chat with unread messages" : "chats with unread messages", href: "/inbox", count: unseen.n });
  if (unassigned.n > 0) feed.push({ id: "unassigned", kind: "warning", text: unassigned.n === 1 ? "lead with no owner" : "leads with no owner", href: "/crm/customers", count: unassigned.n });
  if (staleLeads.n > 0) feed.push({ id: "stale", kind: "info", text: staleLeads.n === 1 ? "lead untouched for 14+ days" : "leads untouched for 14+ days", href: "/crm/pipeline", count: staleLeads.n });

  if (escalated > 0) feed.push({ id: "case-escalated", kind: "warning", text: escalated === 1 ? "case escalated" : "cases escalated", href: "/o/case", count: escalated });
  if (overdueCases > 0) feed.push({ id: "case-overdue", kind: "warning", text: overdueCases === 1 ? "case past its due date" : "cases past their due date", href: "/o/case", count: overdueCases });

  return ok({ total: feed.reduce((a, f) => a + f.count, 0), feed });
}
