import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { auditPhi } from "@/lib/phi";

// POST /api/customers/merge — {primaryId, dupeId}: fold dupe into primary, delete dupe.
// Moves leads, follow-ups, notes, activities, conversations + messages; unions tags;
// keeps the earliest createdAt and the more recent updatedAt.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.primaryId || !b?.dupeId) return bad("primaryId and dupeId required");
  if (b.primaryId === b.dupeId) return bad("cannot merge a customer into itself");

  const primary = db.prepare("SELECT * FROM customers WHERE id = ?").get(b.primaryId) as Record<string, string> | undefined;
  const dupe = db.prepare("SELECT * FROM customers WHERE id = ?").get(b.dupeId) as Record<string, string> | undefined;
  if (!primary || !dupe) return bad("both customers must exist", 404);

  const now = new Date().toISOString();
  const moved = {
    leads: 0, followups: 0, notes: 0, activities: 0, conversations: 0,
  };

  const tx = db.transaction(() => {
    moved.leads = db.prepare("UPDATE leads SET customerId = ? WHERE customerId = ?").run(primary.id, dupe.id).changes;
    moved.followups = db.prepare("UPDATE followups SET customerId = ? WHERE customerId = ?").run(primary.id, dupe.id).changes;
    moved.notes = db.prepare("UPDATE notes SET customerId = ? WHERE customerId = ?").run(primary.id, dupe.id).changes;
    moved.activities = db.prepare("UPDATE activities SET customerId = ? WHERE customerId = ?").run(primary.id, dupe.id).changes;
    moved.conversations = db.prepare("UPDATE conversations SET customerId = ? WHERE customerId = ?").run(primary.id, dupe.id).changes;

    // fill blanks on primary from dupe, union tags, keep oldest created
    const tags = Array.from(new Set([
      ...JSON.parse(primary.tags ?? "[]") as string[],
      ...JSON.parse(dupe.tags ?? "[]") as string[],
    ]));
    db.prepare(
      `UPDATE customers SET
         email = COALESCE(email, ?), address = COALESCE(address, ?), city = COALESCE(city, ?),
         state = COALESCE(state, ?), pincode = COALESCE(pincode, ?), businessName = COALESCE(businessName, ?),
         assignedStaffId = COALESCE(assignedStaffId, ?),
         tags = ?, unseen = MAX(unseen, ?),
         createdAt = MIN(createdAt, ?), updatedAt = ?
       WHERE id = ?`
    ).run(
      dupe.email, dupe.address, dupe.city, dupe.state, dupe.pincode, dupe.businessName,
      dupe.assignedStaffId, JSON.stringify(tags), dupe.unseen,
      dupe.createdAt, now, primary.id
    );

    db.prepare("DELETE FROM customers WHERE id = ?").run(dupe.id);
    db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(
      `act_${Date.now().toString(36)}`, primary.id, "automation",
      `Merged duplicate "${dupe.name}" (${dupe.phone}) into this record`, now
    );
  });
  tx();

  auditPhi(req, "merge", "customers", primary.id, `absorbed ${dupe.id}`);
  return ok({ id: primary.id, mergedFrom: dupe.id, moved });
}
